import {
  type OperationContract,
  type BusinessError,
} from "../neutral/contracts.js";
import type { Infer } from "../schema.js";
import {
  browserEvent,
  identity,
  silentTelemetry,
  type TraceToken,
  type WebTelemetry,
} from "../neutral/protocol.js";
import {
  action,
  webResource,
  type Action,
  type ActionContext,
  type WebResource,
} from "../web/async.js";
import {
  batch,
  derive,
  state,
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
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
};
type RemoteForm<C extends OperationContract, Field extends string> = {
  fields: Record<Field, Writable<string>>;
  submit: Action<void, RemoteResult<C>>;
};

type NamedSubmission = {
  values: Record<string, string>;
  reset(): void;
};

function readNamedSubmission(form: HTMLFormElement): NamedSubmission {
  const entries = new FormData(form);
  const values = Object.create(null) as Record<string, string>;
  for (const [name, value] of entries) {
    if (typeof value !== "string" || Object.hasOwn(values, name))
      throw new TypeError(`Expected one text value for form field ${name}`);
    values[name] = value.trim();
  }

  const fields = Array.from(form.elements).filter(
    (element): element is HTMLInputElement | HTMLTextAreaElement =>
      (element.localName === "input" || element.localName === "textarea") &&
      entries.has((element as HTMLInputElement).name),
  );
  const snapshots = fields.map((field) => ({ field, value: field.value }));
  return {
    values,
    reset() {
      for (const { field, value } of snapshots) {
        if (
          field.form === form &&
          field.value === value &&
          entries.get(field.name) === value
        ) field.value = field.defaultValue;
      }
    },
  };
}

function bindRemoteForm(defaults: {
  needs?: readonly GraphDefinition[];
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}) {
  /** Submit named HTML controls without allocating reactive field state. */
  function form<C extends OperationContract>(
    contract: C,
    options?: RemoteFormOptions<C> & { fields?: never; input?: never },
  ): RemoteForm<C, never>;
  /** Bind text fields to an operation and reset submitted values after success. */
  function form<C extends OperationContract>(
    contract: C,
    options: RemoteFormOptions<C> & {
      fields: Infer<C["input"]> extends Record<string, unknown>
        ? FormFields<NoInfer<Infer<C["input"]>>>
        : never;
      input?: never;
    },
  ): RemoteForm<C, Extract<keyof Infer<C["input"]>, string>>;
  function form<C extends OperationContract, Field extends string>(
    contract: C,
    options: RemoteFormOptions<C> & {
      fields: Readonly<Record<Field, string>>;
      input: (values: Readonly<Record<Field, string>>) => Infer<C["input"]>;
    },
  ): RemoteForm<C, Field>;
  function form<C extends OperationContract, Field extends string>(
    contract: C,
    options: RemoteFormOptions<C> & {
      fields?: Readonly<Record<Field, FormField<unknown>>>;
      input?: (values: Readonly<Record<Field, string>>) => Infer<C["input"]>;
    } = {},
  ): RemoteForm<C, Field> {
    const {
      id = `${contract.id}.submit`,
      baseUrl = defaults.baseUrl,
      fetch = defaults.fetch,
      input,
      refresh = options.invalidates,
      onSuccess,
    } = options;
    const fieldOptions = options.fields;
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
    ) as Record<Field, Writable<string>>;
    const client = remoteClient(contract, {
      id: `${id}.remote`,
      baseUrl,
      fetch,
    });
    const submit = action<void | HTMLFormElement, RemoteResult<C>>({
      id,
      needs: Object.fromEntries(
        [
          client,
          ...names.map((name) => fields[name]),
          ...new Set([...(defaults.needs ?? []), ...(options.needs ?? [])]),
        ].map((node, index) => [index, node]),
      ),
      invalidates: refresh,
      async run(form, ctx) {
        const submission = form && readNamedSubmission(form);
        const values = Object.fromEntries(
          names.map((name) => [name, fields[name].get()]),
        ) as Record<Field, string>;
        if (!fieldOptions && !submission)
          throw new TypeError("Named-field forms must be submitted from an HTML form");
        const payload = submission
          ? contract.input.parse(submission.values)
          : input
          ? input(values)
          : (Object.fromEntries(
              definitions.map(({ name, parse }) => [
                name,
                parse ? parse(values[name]) : values[name],
              ]),
            ) as Infer<C["input"]>);
        const result = await client.call(payload, ctx);
        if (result.ok && !ctx.signal.aborted) {
          batch(() => {
            for (const { name, initial } of definitions) {
              if (fields[name].get() === values[name])
                ctx.set(fields[name], initial);
            }
            submission?.reset();
            onSuccess?.(result.value, ctx);
          });
        }
        return result;
      },
    });
    if (!fieldOptions) {
      submit.submitForm = (form, ctx) => submit.execute(form, ctx);
    }
    return { fields, submit };
  }
  return form;
}

export const remoteForm = bindRemoteForm({});

type SourceValues<Sources extends readonly Readable<unknown>[]> = {
  [K in keyof Sources]: Sources[K] extends Readable<infer Value>
    ? Value
    : never;
};

/** Share request headers and their reactive dependencies between queries and forms. */
export function remoteApi<
  const Sources extends readonly Readable<unknown>[],
>(options: {
  from: Sources;
  headers: (...values: SourceValues<Sources>) => HeadersInit;
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
  return {
    query<C extends OperationContract>(
      contract: C,
      ...[query]: {} extends Infer<C["input"]>
        ? [
            options?: {
              id?: string;
              input?: (...values: SourceValues<Sources>) => Infer<C["input"]>;
            },
          ]
        : [
            options: {
              id?: string;
              input: (...values: SourceValues<Sources>) => Infer<C["input"]>;
            },
          ]
    ): RemoteResource<C> {
      return remote(contract, {
        id: query?.id ?? `${contract.id}.query`,
        from,
        input: query?.input,
        baseUrl,
        fetch: fetchWithHeaders,
      });
    },
    form: bindRemoteForm({ needs: from, baseUrl, fetch: fetchWithHeaders }),
  };
}

export type RemoteResource<C extends OperationContract> = WebResource<
  Infer<C["output"]>,
  Infer<C["input"]>
> & { result: Readable<RemoteResult<C> | undefined> };
export function remote<C extends OperationContract>(
  contract: C,
  options: {
    id: string;
    from?: readonly Readable<any>[];
    input?: (...values: any[]) => Infer<C["input"]>;
    baseUrl?: string;
    fetch?: typeof globalThis.fetch;
  },
): RemoteResource<C> {
  const client = remoteClient(contract, {
    ...options,
    id: options.id + ".remote",
  });
  const result = webResource<Infer<C["output"]>, Infer<C["input"]>>({
    ...options,
    result: true,
    load: (input, ctx) => client.call(input, ctx) as any,
  });
  result.dependencies = [...(options.from ?? []), client];
  result.relations = [{ to: contract, kind: "REMOTE_CALLS" }];
  const activate = result.activate.bind(result);
  result.activate = (telemetry) => {
    client.activate(telemetry ?? silentTelemetry);
    activate(telemetry);
  };
  const projection = derive({
    id: options.id + ".result",
    from: [result],
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
  return Object.assign(result, { result: projection });
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
