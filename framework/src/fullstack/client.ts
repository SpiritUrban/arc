import {
  type OperationContract,
  type BusinessError,
} from "../neutral/contracts.js";
import { ValidationError, type Infer, type Schema } from "../schema.js";
import { formValue } from "../web/form-value.js";
import { withEventTrigger } from "../web/event-trigger.js";
import {
  browserEvent,
  identity,
  silentTelemetry,
  type TraceToken,
  type WebTelemetry,
} from "../neutral/protocol.js";
import {
  action,
  captureResourceUpdate,
  webResource,
  type Action,
  type ActionContext,
  type ActionOptions,
  type CallableAction,
  type FormSubmission,
  type ResourceSnapshot,
  type WebResource,
} from "../web/async.js";
import {
  batch,
  currentWriteTrace,
  derive,
  graphNeeds,
  state,
  type Computed,
  type GraphNeeds,
  type Readable,
  type Signal,
  type Writable,
} from "../web/reactive.js";
import type { GraphDefinition } from "../neutral/graph.js";
export type RemoteResult<C extends OperationContract> =
  | { ok: true; kind: "success"; value: Infer<C["output"]> }
  | (BusinessError<C["errors"]> & { kind: "business_error" })
  | { ok: false; kind: "fault"; fault: { code: string; status: number } }
  | { ok: false; kind: "cancelled" };
export interface RemoteOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  telemetry?: WebTelemetry;
  signal?: AbortSignal;
  trace?: TraceToken;
  nodeId?: string;
}
export async function remoteCall<C extends OperationContract>(
  contract: C,
  input: Infer<C["input"]>,
  options: RemoteOptions = {},
): Promise<RemoteResult<C>> {
  const trace = options.trace ?? { traceId: identity() },
    spanId = identity(),
    telemetry = options.telemetry ?? silentTelemetry,
    node = options.nodeId ?? `remote:${contract.id}`,
    start = performance.now();
  let outcome: "ok" | "business_error" | "fault" | "cancelled" = "fault";
  browserEvent(telemetry, node, "remote.started", trace, { spanId });
  try {
    const response = await (options.fetch ?? globalThis.fetch)(
      `${options.baseUrl ?? ""}/_arc/call/${encodeURIComponent(contract.id)}`,
      {
        method: "POST",
        credentials: "same-origin",
        signal: options.signal,
        headers: {
          "content-type": "application/json",
          "x-arc-trace-id": trace.traceId,
          "x-arc-parent-span": spanId,
        },
        body: JSON.stringify(input),
      },
    );
    const result = await response.json();
    if (result.ok === true) {
      const value = contract.output.parse(result.value);
      outcome = "ok";
      return { ok: true, kind: "success", value };
    }
    if (
      result.kind === "business_error" &&
      Object.hasOwn(contract.errors, result.error)
    ) {
      const definition = contract.errors[result.error];
      if (typeof definition !== "number" && definition.details)
        result.details = definition.details.parse(result.details);
      outcome = "business_error";
      return result;
    }
    return {
      ok: false,
      kind: "fault",
      fault: {
        code:
          typeof result.fault?.code === "string"
            ? result.fault.code
            : "REMOTE_FAULT",
        status: response.status,
      },
    };
  } catch {
    if (options.signal?.aborted) {
      outcome = "cancelled";
      return { ok: false, kind: "cancelled" };
    }
    return {
      ok: false,
      kind: "fault",
      fault: { code: "TRANSPORT_FAULT", status: 0 },
    };
  } finally {
    browserEvent(telemetry, node, "remote.finished", trace, {
      spanId,
      outcome,
      duration: performance.now() - start,
    });
  }
}
export function remoteClient<C extends OperationContract>(
  contract: C,
  options: { id: string; baseUrl?: string; fetch?: typeof globalThis.fetch },
) {
  let telemetry: WebTelemetry = silentTelemetry;
  return {
    id: options.id,
    kind: "remote-endpoint" as const,
    runtime: "browser" as const,
    relations: [{ to: contract, kind: "REMOTE_CALLS" as const }],
    activate(t: WebTelemetry) {
      telemetry = t;
    },
    call(
      input: Infer<C["input"]>,
      ctx: { signal?: AbortSignal; trace?: TraceToken } = {},
    ) {
      return remoteCall(contract, input, {
        ...options,
        ...ctx,
        nodeId: options.id,
        telemetry,
      });
    },
  } satisfies GraphDefinition & { call: unknown };
}

type FormField<T> =
  | (string extends T ? string : never)
  | { initial: string; parse: (value: string) => T };
type FormFields<T> = {
  readonly [K in Extract<keyof T, string>]-?: FormField<T[K]>;
};

export function textField(initial = "") {
  return { initial, parse: (value: string) => value.trim() };
}

export function integerField(initial: number) {
  return { initial: String(initial), parse: Number };
}

type UpdateErrorCode<C extends OperationContract> = {
  [Code in keyof C["errors"] & string]: C["errors"][Code] extends {
    details: Schema<infer Details>;
  } ? [Details] extends [Infer<C["output"]>] ? Code : never : never;
}[keyof C["errors"] & string];

type RemoteFormOptions<C extends OperationContract> = {
  id?: string;
  needs?: GraphNeeds;
  /** Reload these resources after a successful submission. */
  refresh?: WebResource<any, any> | readonly WebResource<any, any>[];
  /** @deprecated Use `refresh`. When both are present, `refresh` takes precedence. */
  invalidates?: WebResource<any, any> | readonly WebResource<any, any>[];
  /** Apply local state changes after a successful response, before refreshing resources. */
  onSuccess?: (value: Infer<C["output"]>, ctx: ActionContext) => void;
  /** Restore submitted fields to their initial values after success. Defaults to true. */
  resetOnSuccess?: boolean;
  update?: MutationUpdate<Infer<C["output"]>> | readonly MutationUpdate<Infer<C["output"]>>[];
  /** Also apply update using the typed details of these business errors. */
  updateOnError?: UpdateErrorCode<NoInfer<C>> | readonly UpdateErrorCode<NoInfer<C>>[];
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
};
type RemoteForm<C extends OperationContract, Field extends string> = {
  fields: Record<Field, Signal<string>>;
  submit: Action<void, RemoteResult<C>>;
};

type NamedSubmission = {
  values: Record<string, string | number | boolean | readonly (string | number)[]>;
  reset?(ctx: ActionContext): void;
};

type NamedFieldRules = {
  numericFields: ReadonlySet<string>;
  booleanFields: ReadonlySet<string>;
  arrayFields: ReadonlyMap<string, string>;
  blankOptionalFields: ReadonlySet<string>;
};

function readNamedSubmission(
  form: HTMLFormElement,
  submitter: HTMLElement | null | undefined,
  { numericFields, booleanFields, arrayFields, blankOptionalFields }: NamedFieldRules,
  resetOnSuccess: boolean,
): NamedSubmission {
  const entries = new FormData(form, submitter ?? undefined);
  const controls = Array.from(form.elements).filter((element) => !element.matches(":disabled"));
  const values = Object.create(null) as NamedSubmission["values"];
  for (const [name, value] of entries) {
    const arrayItemType = arrayFields.get(name);
    if (arrayItemType) {
      if (typeof value !== "string")
        throw new TypeError(`Expected text values for form field ${name}`);
      const valuesForField =
        (values[name] as (string | number)[] | undefined) ?? [];
      const text = value.trim();
      valuesForField.push(
        (arrayItemType === "number" || arrayItemType === "integer") &&
            /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)
          ? Number(text)
          : text,
      );
      values[name] = valuesForField;
      continue;
    }
    if (typeof value !== "string" || Object.hasOwn(values, name))
      throw new TypeError(`Expected one text value for form field ${name}`);
    const text = value.trim();
    values[name] =
      numericFields.has(name) && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)
        ? Number(text)
        : text;
  }

  for (const name of blankOptionalFields) {
    if (values[name] !== "") continue;
    const badInput = controls.some((control) =>
      control.localName === "input" && (control as HTMLInputElement).name === name &&
      (control as HTMLInputElement).validity?.badInput,
    );
    if (!badInput) delete values[name];
  }

  const checkboxes = controls.filter(
    (element): element is HTMLInputElement =>
      element.localName === "input" &&
      (element as HTMLInputElement).type === "checkbox" &&
      booleanFields.has((element as HTMLInputElement).name),
  );
  for (const checkbox of checkboxes) {
    if (
      Object.hasOwn(values, checkbox.name) &&
      typeof values[checkbox.name] === "boolean"
    )
      throw new TypeError(`Expected one checkbox for form field ${checkbox.name}`);
    values[checkbox.name] = checkbox.checked;
  }

  const arrayControls = controls.filter(
    (element): element is HTMLSelectElement | HTMLInputElement =>
      ((element.localName === "select" && (element as HTMLSelectElement).multiple) ||
        (element.localName === "input" && (element as HTMLInputElement).type === "checkbox")) &&
      arrayFields.has((element as HTMLInputElement).name),
  );
  for (const control of arrayControls) {
    if (!Object.hasOwn(values, control.name)) values[control.name] = [];
  }

  if (!resetOnSuccess) return { values };
  const fields = controls.filter(
    (element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
      element !== submitter &&
      (element.localName === "input" || element.localName === "textarea" ||
        element.localName === "select") &&
      (entries.has((element as HTMLInputElement).name) ||
        ((element as HTMLInputElement).type === "checkbox" &&
          (booleanFields.has((element as HTMLInputElement).name) ||
            arrayFields.has((element as HTMLInputElement).name))) ||
        ((element as HTMLInputElement).localName === "select" &&
          (element as HTMLSelectElement).multiple &&
          arrayFields.has((element as HTMLSelectElement).name))),
  );
  const snapshots = fields.map((field) => {
    const binding = formValue(field);
    return {
      field,
      value: field.value,
      checked:
        field.localName === "input"
          ? (field as HTMLInputElement).checked
          : undefined,
      selected:
        field.localName === "select" && (field as HTMLSelectElement).multiple
          ? Array.from((field as HTMLSelectElement).selectedOptions, (option) => option.value)
          : undefined,
      binding,
      stateValue: binding?.state.get(),
    };
  });
  return {
    values,
    reset(ctx) {
      for (const { field, value, checked, selected, binding, stateValue } of snapshots) {
        const isCheckedControl =
          field.localName === "input" &&
          ["checkbox", "radio"].includes((field as HTMLInputElement).type);
        const isMultipleSelect =
          field.localName === "select" && (field as HTMLSelectElement).multiple;
        const currentSelected = isMultipleSelect
          ? Array.from((field as HTMLSelectElement).selectedOptions, (option) => option.value)
          : undefined;
        if (
          field.form !== form ||
          field.value !== value ||
          (isCheckedControl && (field as HTMLInputElement).checked !== checked) ||
          (isMultipleSelect && JSON.stringify(currentSelected) !== JSON.stringify(selected)) ||
          (!isCheckedControl && !isMultipleSelect && entries.get(field.name) !== value) ||
          formValue(field) !== binding
        ) continue;
        if (binding) {
          if (binding.state.get() !== stateValue) continue;
          if (binding.kind === "value") {
            ctx.set(binding.state, binding.initial);
            field.value = binding.initial;
          } else if (binding.kind === "radio") {
            ctx.set(binding.state, binding.initial);
          } else if (binding.kind === "values") {
            ctx.set(binding.state, binding.initial);
          } else {
            ctx.set(binding.state, binding.initial);
            (field as HTMLInputElement).checked = binding.initial;
          }
        } else {
          if (isCheckedControl)
            (field as HTMLInputElement).checked =
              (field as HTMLInputElement).defaultChecked;
          else if (field.localName === "select")
            for (const option of (field as HTMLSelectElement).options)
              option.selected = option.defaultSelected;
          else {
            const textField = field as HTMLInputElement | HTMLTextAreaElement;
            textField.value = textField.defaultValue;
          }
        }
      }
    },
  };
}

type RemoteFormDefaults = {
  needs?: readonly GraphDefinition[];
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
};

type NamedFormOptions<C extends OperationContract> =
  RemoteFormOptions<C> & {
    fields?: never;
    input?: never;
    /** Supply contract fields from context, such as an ID from the page route. */
    params?: Partial<NoInfer<Infer<C["input"]>>>;
  };

type ReactiveFormOptions<C extends OperationContract> = RemoteFormOptions<C> & {
  fields: Infer<C["input"]> extends Record<string, unknown>
    ? FormFields<NoInfer<Infer<C["input"]>>>
    : never;
  input?: never;
};

type MappedFormOptions<C extends OperationContract, Field extends string> =
  RemoteFormOptions<C> & {
    fields: Readonly<Record<Field, string>>;
    input: (values: Readonly<Record<Field, string>>) => Infer<C["input"]>;
  };

type FormOptions<C extends OperationContract, Field extends string> =
  RemoteFormOptions<C> & {
    params?: Partial<Infer<C["input"]>>;
    fields?: Readonly<Record<Field, FormField<unknown>>>;
    input?: (values: Readonly<Record<Field, string>>) => Infer<C["input"]>;
  };

type MutationKey = string | number;
type MutationFieldErrors<C extends OperationContract> = {
  fieldErrors?: Partial<Record<
    InputField<NoInfer<C>>,
    keyof C["errors"] & string
  >>;
};
type KeyedMutationOptions<C extends OperationContract, Key extends MutationKey> = MutationFieldErrors<C> & {
  key?: (input: Infer<C["input"]>) => Key;
};

export type NamedMutationOptions<C extends OperationContract, Key extends MutationKey> =
  NamedFormOptions<C> & KeyedMutationOptions<C, Key>;

type MutationInput<C extends OperationContract> = Infer<C["input"]>;
export type MutationKeyField<C extends OperationContract> = RowKey<MutationInput<C>>;
export type MutationFieldKey<C extends OperationContract, Field extends MutationKeyField<C>> =
  Extract<MutationInput<C>[Field], MutationKey>;

export type FieldKeyMutationOptions<C extends OperationContract, Field extends MutationKeyField<C>> =
  NamedFormOptions<C> & MutationFieldErrors<C> & { key: Field };

type ScalarMutationInput<Input, Field extends keyof Input> = {
  [Name in Field]: Pick<Input, Name> extends Input ? never : Name;
}[Field] extends never ? Input[Field] : never;

export type Mutation<
  C extends OperationContract,
  Field extends string = never,
  Key extends MutationKey = MutationKey,
  KeyField extends string = never,
> =
  CallableAction<void, RemoteResult<C>> & {
    fields: RemoteForm<C, Field>["fields"];
    failed(code: keyof C["errors"] & string, key?: Key): boolean;
    invalid(): boolean;
    invalid(field: InputField<C>): boolean;
    invalidField(field: InputField<C>): Computed<boolean>;
    field(name: InputField<C>): {
      input: FieldInputAttributes;
      invalid: Computed<boolean>;
      failed(): boolean;
    };
    run(input: Infer<C["input"]>): Promise<RemoteResult<C>>;
    for(input: MutationInput<C> | ScalarMutationInput<MutationInput<C>, KeyField & keyof MutationInput<C>>): {
      run(): Promise<RemoteResult<C>>;
      pending(): boolean;
      outcome(): MutationOutcome<C> | undefined;
      failed(code: keyof C["errors"] & string): boolean;
    };
    with: [Field] extends [never]
      ? (params: Partial<Infer<C["input"]>>) => FormSubmission
      : never;
    pending(key: Key): boolean;
    outcome(key: Key): MutationOutcome<C> | undefined;
  };

type MutationOutcome<C extends OperationContract> = {
  readonly result: RemoteResult<C> | undefined;
  readonly error: unknown;
};

const directInput = Symbol("ARC mutation input");
type DirectSubmission<C extends OperationContract> = { [directInput]: Infer<C["input"]> };

const formInput = Symbol("ARC named form input");
type BoundSubmission<C extends OperationContract> = {
  [formInput]: HTMLFormElement;
  submitter?: HTMLElement | null;
  params?: Partial<Infer<C["input"]>>;
};
type InputField<C extends OperationContract> =
  Infer<C["input"]> extends Record<string, unknown>
    ? Extract<keyof Infer<C["input"]>, string>
    : never;

type FieldInputAttributes = {
  name: string;
  "aria-invalid": Computed<boolean>;
  type?: "text" | "email" | "number" | "checkbox";
  required?: boolean;
  minlength?: number;
  maxlength?: number;
  min?: number;
  max?: number;
  step?: number | "any";
};

function fieldInputAttributes(
  schema: Schema<unknown>, name: string, invalid: Computed<boolean>,
): FieldInputAttributes {
  const input = { name, "aria-invalid": invalid };
  const field = schema.json.properties?.[name];
  if (field?.type === "boolean") return { ...input, type: "checkbox" };
  const required = Array.isArray(schema.json.required) && schema.json.required.includes(name);
  if (field?.type === "string") {
    const format = field.format;
    return {
      ...input,
      type: format === "email" ? "email" : "text",
      required: required && (field.minLength > 0 || format === "email" || format === "uuid"),
      minlength: field.minLength,
      maxlength: field.maxLength,
    };
  }
  if (field?.type === "number" || field?.type === "integer") {
    const integer = field.type === "integer";
    return {
      ...input,
      type: "number",
      required,
      min: integer && field.minimum !== undefined ? Math.ceil(field.minimum) : field.minimum,
      max: integer && field.maximum !== undefined ? Math.floor(field.maximum) : field.maximum,
      step: integer ? 1 : "any",
    };
  }
  return input;
}

function buildRemoteForm<C extends OperationContract, Field extends string>(
  contract: C, options: FormOptions<C, Field>, defaults: RemoteFormDefaults, callable: true,
): RemoteForm<C, Field> & {
  submit: CallableAction<void | DirectSubmission<C> | BoundSubmission<C>, RemoteResult<C>>;
};
function buildRemoteForm<C extends OperationContract, Field extends string>(
  contract: C, options: FormOptions<C, Field>, defaults: RemoteFormDefaults,
): RemoteForm<C, Field>;
function buildRemoteForm<C extends OperationContract, Field extends string>(
  contract: C, options: FormOptions<C, Field>, defaults: RemoteFormDefaults, callable = false,
): RemoteForm<C, Field> {
  const {
    id = `${contract.id}.submit`,
    baseUrl = defaults.baseUrl,
    fetch = defaults.fetch,
    input,
    params,
    onSuccess,
    resetOnSuccess = true,
    updateOnError,
  } = options;
  const refreshOption = options.refresh ?? options.invalidates;
  const refresh: readonly WebResource<any, any>[] = refreshOption === undefined
    ? []
    : Array.isArray(refreshOption)
      ? refreshOption
      : [refreshOption as WebResource<any, any>];
  const updates: readonly MutationUpdate<Infer<C["output"]>>[] = options.update === undefined
    ? []
    : Array.isArray(options.update)
      ? options.update
      : [options.update as MutationUpdate<Infer<C["output"]>>];
  const updateErrors = new Set<string>(
    typeof updateOnError === "string" ? [updateOnError] : updateOnError,
  );
  const fieldOptions = options.fields;
  const properties = callable && !fieldOptions ? contract.input.json.properties : undefined;
  const namedSchemas = Object.entries<{
    type?: string;
    items?: { type?: string };
    optional?: boolean;
    format?: string;
    minLength?: number;
  }>(properties ?? {});
  const numericFields = new Set(
    namedSchemas
      .filter(([, schema]) => schema.type === "number" || schema.type === "integer")
      .map(([name]) => name),
  );
  const booleanFields = new Set(
    namedSchemas
      .filter(([, schema]) => schema.type === "boolean")
      .map(([name]) => name),
  );
  const arrayFields = new Map(
    namedSchemas
      .filter(([, schema]) =>
        schema.type === "array" &&
        ["string", "number", "integer"].includes(schema.items?.type ?? ""),
      )
      .map(([name, schema]) => [name, schema.items!.type!]),
  );
  const blankOptionalFields = new Set(
    namedSchemas
      .filter(([name, schema]) => schema.optional && (
        numericFields.has(name) ||
        (schema.type === "string" &&
          (schema.format === "email" || schema.format === "uuid" || (schema.minLength ?? 0) > 0))
      ))
      .map(([name]) => name),
  );
  const namedFieldRules = { numericFields, booleanFields, arrayFields, blankOptionalFields };
  const names = Object.keys(fieldOptions ?? {}) as Field[];
  const definitions = names.map((name) => {
    const field = fieldOptions![name];
    return typeof field === "string"
      ? { name, initial: field }
      : { name, initial: field.initial, parse: field.parse };
  });
  const fields = Object.fromEntries(
    definitions.map(({ name, initial }) => [
      name,
      state({ id: `${id}.fields.${name}`, initial }),
    ]),
  ) as unknown as Record<Field, Signal<string>>;
  const client = remoteClient(contract, {
    id: `${id}.remote`,
    baseUrl,
    fetch,
  });
  const definition: ActionOptions<void | DirectSubmission<C> | BoundSubmission<C>, RemoteResult<C>> = {
    id,
    needs: Object.fromEntries(
      [
        client,
        ...names.map((name) => fields[name]),
        ...new Set([...(defaults.needs ?? []), ...graphNeeds(options.needs)]),
      ].map((node, index) => [index, node]),
    ),
    invalidates: refresh,
    async run(request, ctx) {
      const apply = updates.map((update) => update.capture());
      async function execute(input: Infer<C["input"]>, reset?: () => void) {
        const result = await client.call(input, ctx);
        if (ctx.signal.aborted) return result;
        if (result.ok) {
          batch(() => {
            reset?.();
            for (const update of apply) update(result.value, ctx.trace);
            onSuccess?.(result.value, ctx);
          });
        } else if (result.kind === "business_error" && updateErrors.has(result.error)) {
          // The selected error codes declare details compatible with the output.
          const value = result.details as Infer<C["output"]>;
          batch(() => {
            for (const update of apply) update(value, ctx.trace);
          });
        }
        return result;
      }
      if (request && directInput in request) {
        return execute(contract.input.parse(request[directInput]));
      }
      const submission = request &&
        readNamedSubmission(request[formInput], request.submitter, namedFieldRules, resetOnSuccess);
      const values = Object.fromEntries(
        names.map((name) => [name, fields[name].get()]),
      ) as Record<Field, string>;
      if (!fieldOptions && !submission)
        throw new TypeError("Named-field forms must be submitted from an HTML form");
      const payload = submission && request
        ? { ...submission.values, ...params, ...request.params }
        : input
        ? input(values)
        : (Object.fromEntries(
            definitions.map(({ name, parse }) => [
              name,
              parse ? parse(values[name]) : values[name],
            ]),
          ) as Infer<C["input"]>);
      const validated = submission || callable ? contract.input.parse(payload) : payload;
      return execute(validated, resetOnSuccess ? () => {
        for (const { name, initial } of definitions) {
          if (fields[name].get() === values[name])
            ctx.set(fields[name], initial);
        }
        submission?.reset?.(ctx);
      } : undefined);
    },
  };
  const submit = callable ? action({ ...definition, callable: true }) : action(definition);
  const activate = submit.activate;
  submit.activate = (telemetry) => {
    client.activate(telemetry ?? silentTelemetry);
    activate(telemetry);
  };
  if (updates.length) submit.relations = [
    ...(submit.relations ?? []),
    ...updates.map((update) => ({ to: update.target, kind: "UPDATES" as const })),
  ];
  if (!fieldOptions) {
    submit.submitForm = (form, ctx) =>
      submit.execute({ [formInput]: form, submitter: ctx.submitter }, ctx);
  }
  return { fields, submit };
}

function bindRemoteForm(defaults: RemoteFormDefaults) {
  function form<C extends OperationContract>(
    contract: C, options?: NamedFormOptions<C>,
  ): RemoteForm<C, never>;
  function form<C extends OperationContract>(
    contract: C, options: ReactiveFormOptions<C>,
  ): RemoteForm<C, Extract<keyof Infer<C["input"]>, string>>;
  function form<C extends OperationContract, Field extends string>(
    contract: C, options: MappedFormOptions<C, Field>,
  ): RemoteForm<C, Field>;
  function form<C extends OperationContract, Field extends string>(
    contract: C, options: FormOptions<C, Field> = {},
  ): RemoteForm<C, Field> {
    return buildRemoteForm(contract, options, defaults);
  }
  return form;
}

function bindMutation(defaults: RemoteFormDefaults) {
  function mutate<C extends OperationContract, Field extends MutationKeyField<NoInfer<C>>>(
    contract: C, options: FieldKeyMutationOptions<NoInfer<C>, Field>,
  ): Mutation<C, never, MutationFieldKey<C, Field>, Field>;
  function mutate<C extends OperationContract, Field extends MutationKeyField<NoInfer<C>>>(
    contract: C, options: ReactiveFormOptions<C> & MutationFieldErrors<C> & { key: Field },
  ): Mutation<C, Extract<keyof MutationInput<C>, string>, MutationFieldKey<C, Field>, Field>;
  function mutate<C extends OperationContract, Field extends string, Name extends MutationKeyField<NoInfer<C>>>(
    contract: C, options: MappedFormOptions<C, Field> & MutationFieldErrors<C> & { key: Name },
  ): Mutation<C, Field, MutationFieldKey<C, Name>, Name>;
  function mutate<C extends OperationContract, Key extends MutationKey = MutationKey>(
    contract: C, options?: NamedMutationOptions<C, Key>,
  ): Mutation<C, never, Key>;
  function mutate<C extends OperationContract, Key extends MutationKey = MutationKey>(
    contract: C, options: ReactiveFormOptions<C> & KeyedMutationOptions<C, Key>,
  ): Mutation<C, Extract<keyof Infer<C["input"]>, string>, Key>;
  function mutate<C extends OperationContract, Field extends string, Key extends MutationKey = MutationKey>(
    contract: C, options: MappedFormOptions<C, Field> & KeyedMutationOptions<C, Key>,
  ): Mutation<C, Field, Key>;
  function mutate<C extends OperationContract, Field extends string, Key extends MutationKey>(
    contract: C,
    options: FormOptions<C, Field> & MutationFieldErrors<C> &
      { key?: ((input: MutationInput<C>) => Key) | MutationKeyField<C> } = {},
  ): Mutation<C, Field, Key> {
    const { fields, submit } = buildRemoteForm(contract, options, defaults, true);
    const key = options.key;
    const keyOf = typeof key === "string" ? (input: MutationInput<C>) => input[key] as Key : key;
    const requests = new Map<Key, Promise<RemoteResult<C>>>();
    const outcomes = new Map<Key, MutationOutcome<C>>();
    const fieldErrors = new Map(
      Object.entries(options.fieldErrors ?? {}) as [string, (keyof C["errors"] & string) | undefined][],
    );
    const invalidFields = new Map<string, Computed<boolean>>();
    const revision = keyOf && state({ id: `${submit.id}.pending`, initial: 0 });
    let disposed = false;
    if (revision) {
      submit.dependencies = [...(submit.dependencies ?? []), revision];
    }
    const dispose = submit.dispose.bind(submit);
    submit.dispose = () => {
      if (disposed) return;
      disposed = true;
      for (const field of invalidFields.values()) field.dispose();
      invalidFields.clear();
      requests.clear();
      outcomes.clear();
      revision?.dispose();
      dispose();
    };
    const bindForm = (params: Partial<Infer<C["input"]>>): FormSubmission => {
      const values = { ...params };
      return {
        kind: "form-submission",
        action: submit,
        submit: (form, ctx) =>
          submit.execute({ [formInput]: form, submitter: ctx.submitter, params: values }, ctx),
      };
    };
    const mutation = Object.assign(submit, {
      fields,
      with: (options.fields ? undefined : bindForm) as Mutation<C, Field, Key>["with"],
      for(input: MutationInput<C> | MutationKey) {
        if (!keyOf) throw new TypeError("mutation.for requires a mutation key");
        const payload = (typeof key === "string" && (typeof input === "string" || typeof input === "number")
          ? { [key]: input }
          : input) as MutationInput<C>;
        return withEventTrigger({
          run: withEventTrigger(() => mutation.run(payload), submit),
          pending: () => mutation.pending(keyOf(payload)),
          outcome: () => mutation.outcome(keyOf(payload)),
          failed: (code: keyof C["errors"] & string) => mutation.failed(code, keyOf(payload)),
        }, submit);
      },
      run(payload: Infer<C["input"]>) {
        const trace = currentWriteTrace();
        if (!keyOf || !revision || disposed)
          return submit.execute({ [directInput]: payload }, { trace });
        const key = keyOf(payload);
        const existing = requests.get(key);
        if (existing) return existing;
        let start!: () => void;
        const request = new Promise<RemoteResult<C>>((resolve) => {
          start = () => resolve(submit.execute({ [directInput]: payload }, { trace }));
        }).then(
          (result) => {
            if (!disposed) outcomes.set(key, { result, error: result.ok ? undefined : result });
            return result;
          },
          (error: unknown) => {
            if (!disposed) outcomes.set(key, { result: undefined, error });
            throw error;
          },
        ).finally(() => {
          if (requests.delete(key)) revision.update((value) => value + 1);
        });
        outcomes.delete(key);
        requests.set(key, request);
        revision.update((value) => value + 1);
        start();
        return request;
      },
      pending(key: Key) {
        revision?.get();
        return requests.has(key);
      },
      outcome(key: Key) {
        revision?.get();
        return outcomes.get(key);
      },
      failed(code: keyof C["errors"] & string, key?: Key) {
        let result: RemoteResult<C> | undefined;
        if (key === undefined) {
          const snapshot = submit();
          result = snapshot.status === "error" ? snapshot.result : undefined;
        } else {
          revision?.get();
          result = outcomes.get(key)?.result;
        }
        return matchesBusinessError<C>(result, code);
      },
      invalid(field?: InputField<C>) {
        return invalidInput(submit.error(), field);
      },
      invalidField(field: InputField<C>) {
        if (disposed) throw new Error(`Disposed mutation: ${submit.id}`);
        const id = `${submit.id}.invalid.${field}`;
        let invalid = invalidFields.get(id);
        if (!invalid) {
          invalid = derive(id, submit.error, (error) => invalidInput(error, field));
          invalidFields.set(id, invalid);
        }
        return invalid;
      },
      field(name: InputField<C>) {
        if (disposed) throw new Error(`Disposed mutation: ${submit.id}`);
        const code = fieldErrors.get(name);
        const id = `${submit.id}.field.${name}.invalid`;
        let invalid = invalidFields.get(id);
        if (code === undefined) {
          invalid = mutation.invalidField(name);
        } else if (!invalid) {
          invalid = derive(id, submit, ({ error, result, status }) =>
            invalidInput(error, name) ||
            (status === "error" && matchesBusinessError<C>(result, code)));
          invalidFields.set(id, invalid);
        }
        return {
          input: fieldInputAttributes(contract.input, name, invalid),
          invalid,
          failed: () => code !== undefined && mutation.failed(code),
        };
      },
    });
    withEventTrigger(mutation.run, submit);
    return mutation;
  }
  return mutate;
}

function invalidInput(error: unknown, field?: string): boolean {
  return error instanceof ValidationError && (field === undefined || error.fields.includes(field));
}

function matchesBusinessError<C extends OperationContract>(
  result: RemoteResult<C> | undefined, code: string,
): boolean {
  return result?.kind === "business_error" && result.error === code;
}

/** @deprecated Use `mutation`; it provides the same fields and form submission API plus `run` for direct actions. */
export const remoteForm = bindRemoteForm({});
export const mutation = bindMutation({});

type RemoteSources = Readable<unknown> | readonly Readable<unknown>[];
function sourceList(from: RemoteSources): readonly Readable<unknown>[] {
  return Array.isArray(from) ? from : [from as Readable<unknown>];
}

type SourceValues<Sources extends RemoteSources> = Sources extends Readable<infer Value>
  ? [Value]
  : Sources extends readonly Readable<unknown>[]
    ? { [K in keyof Sources]: Sources[K] extends Readable<infer Value> ? Value : never }
    : never;

function encodeCacheValue(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "undefined": return "undefined";
    case "string": return `string:${JSON.stringify(value)}`;
    case "boolean": return `boolean:${value}`;
    case "number": return `number:${Object.is(value, -0) ? "-0" : String(value)}`;
    case "bigint": return `bigint:${value}`;
    case "symbol":
    case "function":
      throw new TypeError("Cached remoteApi queries need JSON-like from values or an explicit key");
    case "object": {
      if (ancestors.has(value))
        throw new TypeError("Cached remoteApi queries need acyclic from values or an explicit key");
      ancestors.add(value);
      try {
        if (Array.isArray(value))
          return `array:${JSON.stringify(value.map((item) => encodeCacheValue(item, ancestors)))}`;
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null)
          throw new TypeError("Cached remoteApi queries need plain from values or an explicit key");
        const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
        return `object:${JSON.stringify(entries.map(([key, item]) => [key, encodeCacheValue(item, ancestors)]))}`;
      } finally {
        ancestors.delete(value);
      }
    }
    default:
      throw new TypeError("Cached remoteApi queries need JSON-like from values or an explicit key");
  }
}

function querySourceKey(values: readonly unknown[]) {
  return JSON.stringify(values.map((value) => encodeCacheValue(value)));
}

function bindQueryKey<Values extends readonly unknown[]>(
  key: true | ((...values: Values) => string | number) | undefined,
  sources: readonly Readable<unknown>[],
): (() => string | number) | undefined {
  if (key === undefined) return undefined;
  return () => {
    const values = sources.map((source) => source.get());
    return key === true ? querySourceKey(values) : key(...values as unknown as Values);
  };
}

type ClientQueryOptions<C extends OperationContract, Sources extends RemoteSources> = {
  id?: string;
  /** Override the cache context. By default, cached queries use all `from` values. */
  key?: true | ((...values: SourceValues<Sources>) => string | number);
  cache?: boolean;
} & ({} extends Infer<C["input"]>
  ? {
      input?: (...values: SourceValues<Sources>) => Infer<C["input"]>;
      params?: Infer<C["input"]>;
    }
  : {
      input: (...values: SourceValues<Sources>) => Infer<C["input"]>;
    } | {
      /** Use route parameters directly when they form the complete operation input. */
      params: Infer<C["input"]>;
    });

type RemoteApiOptions<Sources extends RemoteSources> = {
  from?: Sources;
  headers?: HeadersInit | ((...values: SourceValues<Sources>) => HeadersInit);
  key?: true | ((...values: SourceValues<Sources>) => string | number);
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
} & (Sources extends readonly [] ? {} : { from: Sources });

/** Share request headers and their reactive dependencies between queries and forms. */
export function remoteApi<const Sources extends RemoteSources = readonly []>(
  options: RemoteApiOptions<Sources>,
) {
  const from = options.from === undefined ? [] : sourceList(options.from);
  const { headers, baseUrl } = options;
  const fetchWithHeaders: typeof globalThis.fetch | undefined = headers === undefined ? options.fetch : (url, init) => {
    const common = typeof headers === "function"
      ? headers(...from.map((source) => source.get()) as SourceValues<Sources>)
      : headers;
    const merged = new Headers(common);
    new Headers(init?.headers).forEach((value, key) =>
      merged.set(key, value),
    );
    return (options.fetch ?? globalThis.fetch)(url, {
      ...init,
      headers: merged,
    });
  };
  const defaults = { needs: from, baseUrl, fetch: fetchWithHeaders };
  return {
    query<C extends OperationContract>(
      contract: C,
      ...[query]: {} extends Infer<C["input"]>
        ? [options?: ClientQueryOptions<C, Sources>]
        : [options: ClientQueryOptions<C, Sources>]
    ): RemoteQuery<C> {
      const keyOption = query?.key ?? options.key ?? (query?.cache ? true : undefined);
      return createRemoteResource(contract, {
        id: query?.id ?? `${contract.id}.query`,
        from,
        input: query && "input" in query ? query.input : query && "params" in query
          ? () => query.params as Infer<C["input"]>
          : undefined,
        key: bindQueryKey(keyOption, from),
        cache: query?.cache,
        baseUrl,
        fetch: fetchWithHeaders,
      }, true);
    },
    form: bindRemoteForm(defaults),
    mutation: bindMutation(defaults),
  };
}

export type RemoteResource<C extends OperationContract> = WebResource<
  Infer<C["output"]>,
  Infer<C["input"]>
> & {
  result: Computed<RemoteResult<C> | undefined>;
  /** Use a successful mutation response as the complete query value. */
  replace(): MutationUpdate<Infer<C["output"]>>;
};

type QueryItem<C extends OperationContract> =
  Infer<C["output"]> extends readonly (infer Row)[] ? Row : never;

type RowKey<Row> = [Row] extends [never] ? never : {
  [Key in keyof Row]-?: Row[Key] extends string | number ? Key : never;
}[keyof Row] & string;

type DefaultRowKeyArgument<Row> = [Row] extends [never]
  ? never
  : [Row] extends [{ id: string | number }] ? [] : never;

type RowKeyArgument<Row> = [field: RowKey<Row>] | DefaultRowKeyArgument<Row>;

type MutationUpdate<Row> = {
  readonly target: GraphDefinition;
  capture(): (row: Row, trace: TraceToken) => void;
};

/** Set a writable value from a confirmed mutation response. */
export function setFrom<Output, Value>(
  target: Writable<Value>,
  select: (output: Output) => NoInfer<Value>,
): MutationUpdate<Output>;
export function setFrom<Value, const Field extends string>(
  target: Writable<Value>,
  field: string extends Field ? never : Field,
): MutationUpdate<Record<Field, Value>>;
export function setFrom<Output, Value, Field extends string>(
  target: Writable<Value>,
  select: ((output: Output) => Value) | Field,
): MutationUpdate<Output> {
  return {
    target,
    capture: () => (output, trace) => {
      const value = typeof select === "function"
        ? select(output)
        : (output as Record<Field, Value>)[select];
      target._trace = trace;
      target.set(value);
    },
  };
}

export type RemoteQuery<C extends OperationContract> =
  RemoteResource<C> & (() => ResourceSnapshot<Infer<C["output"]>>) & {
    /** Derive a value from the current query data, including when it is absent. */
    select<T>(compute: (data: Infer<C["output"]> | undefined) => T): Computed<T>;
    select<T>(name: string, compute: (data: Infer<C["output"]> | undefined) => T): Computed<T>;
    select<const Sources extends RemoteSources, T>(
      from: Sources,
      compute: (data: Infer<C["output"]> | undefined, ...values: SourceValues<Sources>) => T,
    ): Computed<T>;
    select<const Sources extends RemoteSources, T>(
      name: string,
      from: Sources,
      compute: (data: Infer<C["output"]> | undefined, ...values: SourceValues<Sources>) => T,
    ): Computed<T>;
    replaceBy(...[field]: RowKeyArgument<QueryItem<C>>): MutationUpdate<QueryItem<C>>;
    /** Append a confirmed new row to a loaded list, preserving any row with the same key. */
    insertBy(...[field]: RowKeyArgument<QueryItem<C>>): MutationUpdate<QueryItem<C>>;
  };

type RemoteResourceOptions<C extends OperationContract> = {
  id: string;
  from?: Readable<any> | readonly Readable<any>[];
  input?: (...values: any[]) => Infer<C["input"]>;
  key?: () => string | number;
  cache?: boolean;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
};

// Preserve the existing input callback signature when callers provide only the contract type.
type QuerySourceValues<Sources extends RemoteSources> =
  RemoteSources extends Sources ? any[] : SourceValues<Sources>;

type QueryProjection<C extends OperationContract, Sources extends RemoteSources> = {
  input?: (...values: QuerySourceValues<Sources>) => Infer<C["input"]>;
};

type QueryOptions<C extends OperationContract, Sources extends RemoteSources> =
  Omit<RemoteResourceOptions<C>, "id" | "input" | "from" | "key"> & {
    id?: string;
    from?: Sources;
    /** Use all sources as the key, or select one from their values. */
    key?: true | ((...values: QuerySourceValues<Sources>) => string | number);
  } & (
    | (
        ({} extends Infer<C["input"]>
          ? QueryProjection<C, Sources>
          : Required<QueryProjection<C, Sources>>) & { params?: never }
      )
    | {
        /** Use a fixed contract input on every read. */
        params: NoInfer<Infer<C["input"]>>;
        input?: never;
      }
  );

/** Read the current state of a contract-backed query by calling it. */
export function query<
  C extends OperationContract,
  const Sources extends RemoteSources = RemoteSources,
>(
  contract: C,
  ...[options]: {} extends Infer<C["input"]>
    ? [options?: QueryOptions<C, Sources>]
    : [options: QueryOptions<C, Sources>]
): RemoteQuery<C> {
  const { params, input, key, from, ...settings } = options ?? {};
  const sources = from === undefined ? [] : sourceList(from);
  return createRemoteResource(contract, {
    ...settings,
    id: options?.id ?? `${contract.id}.query`,
    from: sources,
    input: input ?? (options && "params" in options ? () => params as Infer<C["input"]> : undefined),
    key: bindQueryKey(key, sources),
  }, true);
}

export function remote<C extends OperationContract>(
  contract: C,
  options: RemoteResourceOptions<C>,
): RemoteResource<C> {
  return createRemoteResource(contract, options, false);
}

function createRemoteResource<C extends OperationContract>(
  contract: C,
  options: RemoteResourceOptions<C>,
  callable: true,
): RemoteQuery<C>;
function createRemoteResource<C extends OperationContract>(
  contract: C,
  options: RemoteResourceOptions<C>,
  callable: false,
): RemoteResource<C>;
function createRemoteResource<C extends OperationContract>(
  contract: C,
  options: RemoteResourceOptions<C>,
  callable: boolean,
): RemoteResource<C> {
  const from: readonly Readable<any>[] = options.from === undefined
    ? []
    : Array.isArray(options.from)
      ? options.from
      : [options.from as Readable<any>];
  const client = remoteClient(contract, {
    ...options,
    id: options.id + ".remote",
  });
  const resource = {
    ...options,
    result: true,
    load: (input: Infer<C["input"]>, ctx: { signal: AbortSignal; trace: TraceToken }) =>
      client.call(input, ctx) as any,
  };
  const result = callable
    ? webResource<Infer<C["output"]>, Infer<C["input"]>>({ ...resource, callable: true })
    : webResource<Infer<C["output"]>, Infer<C["input"]>>(resource);
  result.dependencies = [...from, client];
  result.relations = [{ to: contract, kind: "REMOTE_CALLS" }];
  const activate = result.activate.bind(result);
  result.activate = (telemetry) => {
    client.activate(telemetry ?? silentTelemetry);
    activate(telemetry);
  };
  const projection = derive({
    id: options.id + ".result",
    from: options.key ? [result, ...from] : [result],
    compute: (snapshot) =>
      snapshot.outcome === "ok"
        ? ({
            ok: true,
            kind: "success",
            value: snapshot.data,
          } as RemoteResult<C>)
        : (snapshot.error as RemoteResult<C> | undefined),
  });
  const selections = new Map<string, Computed<unknown>>();
  let disposed = false;
  const dispose = result.dispose.bind(result);
  result.dispose = () => {
    disposed = true;
    for (const selection of selections.values()) selection.dispose();
    selections.clear();
    projection.dispose();
    dispose();
  };
  type Data = Infer<C["output"]> | undefined;
  function select<const Sources extends RemoteSources, T>(
    ...args:
      | [compute: (data: Data) => T]
      | [name: string, compute: (data: Data) => T]
      | [from: Sources, compute: (data: Data, ...values: SourceValues<Sources>) => T]
      | [name: string, from: Sources, compute: (data: Data, ...values: SourceValues<Sources>) => T]
  ): Computed<T> {
    if (disposed) throw new Error(`Disposed query: ${result.id}`);
    let name: string;
    if (typeof args[0] === "string") {
      name = args[0];
      if (selections.has(name)) throw new Error(`Duplicate query selection ${name} in ${result.id}`);
    } else {
      let index = selections.size;
      while (selections.has(String(index))) index++;
      name = String(index);
    }
    const id = `${result.id}.select.${name}`;
    const [first, second, third] = args;
    const compute = (third ?? second ?? first) as (data: Data, ...values: unknown[]) => T;
    const sources = args.length === 3
      ? args[1]
      : args.length === 2 && typeof args[0] !== "string" ? args[0] : undefined;
    const selection = derive(
      id,
      [result.data, ...(sources ? sourceList(sources) : [])],
      compute,
    );
    selections.set(name, selection);
    return selection;
  }
  return Object.assign(result, {
    result: projection,
    select,
    replace(): MutationUpdate<Infer<C["output"]>> {
      return {
        target: result,
        capture() {
          const apply = result[captureResourceUpdate]?.();
          return (value, trace) => apply?.(() => value, trace);
        },
      };
    },
    replaceBy(
      ...[field = "id" as RowKey<QueryItem<C>>]: RowKeyArgument<QueryItem<C>>
    ): MutationUpdate<QueryItem<C>> {
      return {
        target: result,
        capture() {
          const apply = result[captureResourceUpdate]?.();
          return (row, trace) => apply?.((data) => {
            if (!Array.isArray(data)) return data;
            const index = data.findIndex((item: QueryItem<C>) => Object.is(item[field], row[field]));
            if (index < 0) return data;
            const next = data.slice();
            next[index] = row;
            return next as Infer<C["output"]>;
          }, trace);
        },
      };
    },
    insertBy(
      ...[field = "id" as RowKey<QueryItem<C>>]: RowKeyArgument<QueryItem<C>>
    ): MutationUpdate<QueryItem<C>> {
      return {
        target: result,
        capture() {
          const apply = result[captureResourceUpdate]?.({ refreshWhenMissing: true });
          return (row, trace) => apply?.((data) => {
            if (!Array.isArray(data) ||
                data.some((item: QueryItem<C>) => Object.is(item[field], row[field])))
              return data;
            return [...data, row] as Infer<C["output"]>;
          }, trace);
        },
      };
    },
  });
}
export function telemetryTransport(
  options: { url?: string; fetch?: typeof globalThis.fetch } = {},
): WebTelemetry & {
  flush(): Promise<void>;
  dispose(): Promise<void>;
  events: import("../neutral/protocol.js").BrowserEvent[];
} {
  const pending: import("../neutral/protocol.js").BrowserEvent[] = [],
    events: import("../neutral/protocol.js").BrowserEvent[] = [];
  let scheduled = false,
    disposed = false,
    chain = Promise.resolve();
  const flush = () => {
    scheduled = false;
    const batch = pending.splice(0, 100);
    if (!batch.length) return chain;
    chain = chain.then(async () => {
      try {
        await (options.fetch ?? globalThis.fetch)(
          options.url ?? "/_arc/telemetry",
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ events: batch }),
          },
        );
      } catch {
        /* Telemetry cannot fail user interactions. */
      }
    });
    if (pending.length) void flush();
    return chain;
  };
  return {
    events,
    emit(event) {
      if (disposed) return;
      events.push(event);
      if (events.length > 1000) events.shift();
      pending.push(event);
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => void flush());
      }
    },
    flush,
    async dispose() {
      disposed = true;
      await flush();
    },
  };
}
