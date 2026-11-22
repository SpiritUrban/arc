import {
  type OperationContract,
  type BusinessError,
} from "../neutral/contracts.js";
import { ValidationError, type Infer } from "../schema.js";
import { formValue } from "../web/form-value.js";
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
  type ResourceSnapshot,
  type WebResource,
} from "../web/async.js";
import {
  batch,
  currentWriteTrace,
  derive,
  state,
  type Computed,
  type Readable,
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

type RemoteFormOptions<C extends OperationContract> = {
  id?: string;
  needs?: readonly GraphDefinition[];
  /** Reload these resources after a successful submission. */
  refresh?: readonly WebResource<any, any>[];
  /** An alias for refresh. When both are present, refresh takes precedence. */
  invalidates?: readonly WebResource<any, any>[];
  /** Apply local state changes after a successful response, before refreshing resources. */
  onSuccess?: (value: Infer<C["output"]>, ctx: ActionContext) => void;
  update?: QueryUpdate<Infer<C["output"]>>;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
};
type RemoteForm<C extends OperationContract, Field extends string> = {
  fields: Record<Field, Writable<string>>;
  submit: Action<void, RemoteResult<C>>;
};

type NamedSubmission = {
  values: Record<string, string | number>;
  reset(ctx: ActionContext): void;
};

function readNamedSubmission(
  form: HTMLFormElement,
  numericFields: ReadonlySet<string>,
): NamedSubmission {
  const entries = new FormData(form);
  const values = Object.create(null) as NamedSubmission["values"];
  for (const [name, value] of entries) {
    if (typeof value !== "string" || Object.hasOwn(values, name))
      throw new TypeError(`Expected one text value for form field ${name}`);
    const text = value.trim();
    values[name] =
      numericFields.has(name) && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)
        ? Number(text)
        : text;
  }

  const fields = Array.from(form.elements).filter(
    (element): element is HTMLInputElement | HTMLTextAreaElement =>
      (element.localName === "input" || element.localName === "textarea") &&
      entries.has((element as HTMLInputElement).name),
  );
  const snapshots = fields.map((field) => {
    const binding = formValue(field);
    return { field, value: field.value, binding, stateValue: binding?.state.get() };
  });
  return {
    values,
    reset(ctx) {
      for (const { field, value, binding, stateValue } of snapshots) {
        if (field.form !== form || field.value !== value ||
            entries.get(field.name) !== value || formValue(field) !== binding) continue;
        if (binding) {
          if (binding.state.get() !== stateValue) continue;
          ctx.set(binding.state, binding.initial);
          field.value = binding.initial;
        } else {
          field.value = field.defaultValue;
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
  RemoteFormOptions<C> & { fields?: never; input?: never };

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
    fields?: Readonly<Record<Field, FormField<unknown>>>;
    input?: (values: Readonly<Record<Field, string>>) => Infer<C["input"]>;
  };

type MutationKey = string | number;
type KeyedMutationOptions<C extends OperationContract, Key extends MutationKey> = {
  key?: (input: Infer<C["input"]>) => Key;
};

export type Mutation<
  C extends OperationContract,
  Field extends string = never,
  Key extends MutationKey = MutationKey,
> =
  CallableAction<void, RemoteResult<C>> & {
    fields: RemoteForm<C, Field>["fields"];
    failed(code: keyof C["errors"] & string, key?: Key): boolean;
    invalid(field: InputField<C>): boolean;
    run(input: Infer<C["input"]>): Promise<RemoteResult<C>>;
    pending(key: Key): boolean;
    outcome(key: Key): MutationOutcome<C> | undefined;
  };

type MutationOutcome<C extends OperationContract> = {
  readonly result: RemoteResult<C> | undefined;
  readonly error: unknown;
};

const directInput = Symbol("ARC mutation input");
type DirectSubmission<C extends OperationContract> = { [directInput]: Infer<C["input"]> };

type InputField<C extends OperationContract> =
  Infer<C["input"]> extends Record<string, unknown>
    ? Extract<keyof Infer<C["input"]>, string>
    : never;

function buildRemoteForm<C extends OperationContract, Field extends string>(
  contract: C, options: FormOptions<C, Field>, defaults: RemoteFormDefaults, callable: true,
): RemoteForm<C, Field> & {
  submit: CallableAction<void | DirectSubmission<C>, RemoteResult<C>>;
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
    refresh = options.invalidates,
    onSuccess,
    update,
  } = options;
  const fieldOptions = options.fields;
  const properties = callable && !fieldOptions ? contract.input.json.properties : undefined;
  const numericFields = new Set(
    Object.entries<{ type?: string }>(properties ?? {})
      .filter(([, schema]) => schema.type === "number" || schema.type === "integer")
      .map(([name]) => name),
  );
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
  ) as unknown as Record<Field, Writable<string>>;
  const client = remoteClient(contract, {
    id: `${id}.remote`,
    baseUrl,
    fetch,
  });
  const definition: ActionOptions<void | HTMLFormElement | DirectSubmission<C>, RemoteResult<C>> = {
    id,
    needs: Object.fromEntries(
      [
        client,
        ...names.map((name) => fields[name]),
        ...new Set([...(defaults.needs ?? []), ...(options.needs ?? [])]),
      ].map((node, index) => [index, node]),
    ),
    invalidates: refresh,
    async run(request, ctx) {
      const apply = update?.capture();
      if (request && directInput in request) {
        const result = await client.call(contract.input.parse(request[directInput]), ctx);
        if (result.ok && !ctx.signal.aborted) batch(() => {
          apply?.(result.value, ctx.trace);
          onSuccess?.(result.value, ctx);
        });
        return result;
      }
      const submission = request && readNamedSubmission(request, numericFields);
      const values = Object.fromEntries(
        names.map((name) => [name, fields[name].get()]),
      ) as Record<Field, string>;
      if (!fieldOptions && !submission)
        throw new TypeError("Named-field forms must be submitted from an HTML form");
      const payload = submission
        ? submission.values
        : input
        ? input(values)
        : (Object.fromEntries(
            definitions.map(({ name, parse }) => [
              name,
              parse ? parse(values[name]) : values[name],
            ]),
          ) as Infer<C["input"]>);
      const validated = submission || callable ? contract.input.parse(payload) : payload;
      const result = await client.call(validated, ctx);
      if (result.ok && !ctx.signal.aborted) {
        batch(() => {
          for (const { name, initial } of definitions) {
            if (fields[name].get() === values[name])
              ctx.set(fields[name], initial);
          }
          submission?.reset(ctx);
          apply?.(result.value, ctx.trace);
          onSuccess?.(result.value, ctx);
        });
      }
      return result;
    },
  };
  const submit = callable ? action({ ...definition, callable: true }) : action(definition);
  if (update) submit.relations = [
    ...(submit.relations ?? []),
    { to: update.target, kind: "UPDATES" },
  ];
  if (!fieldOptions) {
    submit.submitForm = (form, ctx) => submit.execute(form, ctx);
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
  function mutate<C extends OperationContract, Key extends MutationKey = MutationKey>(
    contract: C, options?: NamedFormOptions<C> & KeyedMutationOptions<C, Key>,
  ): Mutation<C, never, Key>;
  function mutate<C extends OperationContract, Key extends MutationKey = MutationKey>(
    contract: C, options: ReactiveFormOptions<C> & KeyedMutationOptions<C, Key>,
  ): Mutation<C, Extract<keyof Infer<C["input"]>, string>, Key>;
  function mutate<C extends OperationContract, Field extends string, Key extends MutationKey = MutationKey>(
    contract: C, options: MappedFormOptions<C, Field> & KeyedMutationOptions<C, Key>,
  ): Mutation<C, Field, Key>;
  function mutate<C extends OperationContract, Field extends string, Key extends MutationKey>(
    contract: C, options: FormOptions<C, Field> & KeyedMutationOptions<C, Key> = {},
  ): Mutation<C, Field, Key> {
    const { fields, submit } = buildRemoteForm(contract, options, defaults, true);
    const keyOf = options.key;
    const requests = new Map<Key, Promise<RemoteResult<C>>>();
    const outcomes = new Map<Key, MutationOutcome<C>>();
    const revision = keyOf && state({ id: `${submit.id}.pending`, initial: 0 });
    let disposed = false;
    if (revision) {
      submit.dependencies = [...(submit.dependencies ?? []), revision];
      const dispose = submit.dispose.bind(submit);
      submit.dispose = () => {
        disposed = true;
        requests.clear();
        outcomes.clear();
        revision.dispose();
        dispose();
      };
    }
    return Object.assign(submit, {
      fields,
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
        return result?.kind === "business_error" &&
          result.error === code;
      },
      invalid(field: InputField<C>) {
        const { error } = submit();
        return error instanceof ValidationError && error.fields.includes(field);
      },
    });
  }
  return mutate;
}

export const remoteForm = bindRemoteForm({});
export const mutation = bindMutation({});

type SourceValues<Sources extends readonly Readable<unknown>[]> = {
  [K in keyof Sources]: Sources[K] extends Readable<infer Value>
    ? Value
    : never;
};

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

type ClientQueryOptions<C extends OperationContract, Sources extends readonly Readable<unknown>[]> = {
  id?: string;
  /** Override the cache context. By default, cached queries use all `from` values. */
  key?: (...values: SourceValues<Sources>) => string | number;
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

/** Share request headers and their reactive dependencies between queries and forms. */
export function remoteApi<
  const Sources extends readonly Readable<unknown>[],
>(options: {
  from: Sources;
  headers: (...values: SourceValues<Sources>) => HeadersInit;
  key?: (...values: SourceValues<Sources>) => string | number;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}) {
  const { from, headers, baseUrl } = options;
  const fetchWithHeaders: typeof globalThis.fetch = (url, init) => {
    const values = from.map((source) => source.get()) as SourceValues<Sources>;
    const merged = new Headers(headers(...values));
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
      const key = query?.key ?? options.key ?? (query?.cache
        ? (...values: SourceValues<Sources>) => querySourceKey(values)
        : undefined);
      return createRemoteResource(contract, {
        id: query?.id ?? `${contract.id}.query`,
        from,
        input: query && "input" in query ? query.input : query && "params" in query
          ? () => query.params as Infer<C["input"]>
          : undefined,
        key: key && (() => key(...from.map((source) => source.get()) as SourceValues<Sources>)),
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
> & { result: Computed<RemoteResult<C> | undefined> };

type QueryItem<C extends OperationContract> =
  Infer<C["output"]> extends readonly (infer Row)[] ? Row : never;

type RowKey<Row> = [Row] extends [never] ? never : {
  [Key in keyof Row]-?: Row[Key] extends string | number ? Key : never;
}[keyof Row] & string;

type QueryUpdate<Row> = {
  readonly target: GraphDefinition;
  capture(): (row: Row, trace: TraceToken) => void;
};

export type RemoteQuery<C extends OperationContract> =
  RemoteResource<C> & (() => ResourceSnapshot<Infer<C["output"]>>) & {
    replaceBy(field: RowKey<QueryItem<C>>): QueryUpdate<QueryItem<C>>;
  };

type RemoteResourceOptions<C extends OperationContract> = {
  id: string;
  from?: readonly Readable<any>[];
  input?: (...values: any[]) => Infer<C["input"]>;
  key?: () => string | number;
  cache?: boolean;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
};

type QueryOptions<C extends OperationContract> =
  Omit<RemoteResourceOptions<C>, "id"> & { id?: string };

/** Read the current state of a contract-backed query by calling it. */
export function query<C extends OperationContract>(
  contract: C,
  ...[options]: {} extends Infer<C["input"]>
    ? [options?: QueryOptions<C>]
    : [options: QueryOptions<C> & Required<Pick<QueryOptions<C>, "input">>]
): RemoteQuery<C> {
  return createRemoteResource(contract, {
    ...options,
    id: options?.id ?? `${contract.id}.query`,
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
  result.dependencies = [...(options.from ?? []), client];
  result.relations = [{ to: contract, kind: "REMOTE_CALLS" }];
  const activate = result.activate.bind(result);
  result.activate = (telemetry) => {
    client.activate(telemetry ?? silentTelemetry);
    activate(telemetry);
  };
  const projection = derive({
    id: options.id + ".result",
    from: options.key ? [result, ...(options.from ?? [])] : [result],
    compute: (snapshot) =>
      snapshot.outcome === "ok"
        ? ({
            ok: true,
            kind: "success",
            value: snapshot.data,
          } as RemoteResult<C>)
        : (snapshot.error as RemoteResult<C> | undefined),
  });
  const dispose = result.dispose.bind(result);
  result.dispose = () => {
    projection.dispose();
    dispose();
  };
  return Object.assign(result, {
    result: projection,
    replaceBy(field: RowKey<QueryItem<C>>): QueryUpdate<QueryItem<C>> {
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
