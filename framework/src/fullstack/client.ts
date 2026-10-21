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
import { webResource, type WebResource } from "../web/async.js";
import { derive, type Readable } from "../web/reactive.js";
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
