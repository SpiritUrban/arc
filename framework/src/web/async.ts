import type { Schema } from "../schema.js";
import type { GraphDefinition } from "../neutral/graph.js";
import {
  browserEvent,
  identity,
  silentTelemetry,
  type TraceToken,
  type WebTelemetry,
} from "../neutral/protocol.js";
import {
  state,
  derive,
  batch,
  type Readable,
  type Writable,
} from "./reactive.js";
export interface ResourceSnapshot<T> {
  input: unknown;
  data: T | undefined;
  loading: boolean;
  error: unknown;
  stale: boolean;
  outcome: "idle" | "ok" | "business_error" | "fault" | "cancelled";
}
export interface WebResource<T, I = unknown> extends Readable<
  ResourceSnapshot<T>
> {
  data: Readable<T | undefined>;
  loading: Readable<boolean>;
  error: Readable<unknown>;
  stale: Readable<boolean>;
  refresh(trace?: TraceToken): Promise<void>;
  invalidate(trace?: TraceToken): Promise<void>;
  activate(telemetry?: WebTelemetry): void;
  dispose(): void;
  relations?: GraphDefinition["relations"];
}
export function webResource<T, I = unknown>(def: {
  id: string;
  from?: readonly Readable<any>[];
  input?: (...values: any[]) => I;
  load: (
    input: I,
    ctx: { signal: AbortSignal; trace: TraceToken },
  ) => Promise<T>;
  result?: boolean;
  scope?: "application" | "view";
}): WebResource<T, I> {
  const value = state<ResourceSnapshot<T>>({
    id: def.id,
    initial: {
      input: undefined,
      data: undefined,
      loading: false,
      error: undefined,
      stale: true,
      outcome: "idle",
    },
  });
  let generation = 0,
    controller: AbortController | undefined,
    disposed = false,
    active = false,
    telemetry: WebTelemetry = silentTelemetry;
  const stops: (() => void)[] = [];
  const originalDispose = value.dispose.bind(value);
  const projections = [
    derive({ id: def.id + ".data", from: [value], compute: (s) => s.data }),
    derive({
      id: def.id + ".loading",
      from: [value],
      compute: (s) => s.loading,
    }),
    derive({ id: def.id + ".error", from: [value], compute: (s) => s.error }),
    derive({ id: def.id + ".stale", from: [value], compute: (s) => s.stale }),
  ];
  const set = (next: ResourceSnapshot<T>, trace: TraceToken) => {
    value._trace = trace;
    value.set(next);
  };
  const resource = Object.assign(value, {
    kind: "web-resource" as const,
    runtime: "browser" as const,
    dependencies: def.from ?? [],
    metadata: { scope: def.scope ?? "application" },
    data: projections[0] as Readable<T | undefined>,
    loading: projections[1] as Readable<boolean>,
    error: projections[2],
    stale: projections[3] as Readable<boolean>,
    async refresh(trace: TraceToken = { traceId: identity() }) {
      if (disposed) return;
      const current = ++generation;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal,
        spanId = identity(),
        start = performance.now();
      const childTrace = { traceId: trace.traceId, parentId: spanId };
      let input: I;
      set(
        { ...value.get(), loading: true, error: undefined, stale: true },
        trace,
      );
      browserEvent(telemetry, def.id, "resource.started", trace, { spanId });
      let outcome: ResourceSnapshot<T>["outcome"] = "fault";
      try {
        input = def.input
          ? def.input(...(def.from ?? []).map((d) => d.get()))
          : ({} as I);
        const loaded: any = await def.load(input, {
          signal,
          trace: childTrace,
        });
        if (signal.aborted || current !== generation || disposed) {
          outcome = "cancelled";
          return;
        }
        if (def.result && loaded.ok === false) {
          outcome =
            loaded.kind === "fault"
              ? "fault"
              : loaded.kind === "cancelled"
                ? "cancelled"
                : "business_error";
          set(
            {
              ...value.get(),
              loading: false,
              error: loaded,
              stale: false,
              outcome,
            },
            trace,
          );
        } else {
          outcome = "ok";
          set(
            {
              input,
              data: def.result ? loaded.value : loaded,
              loading: false,
              error: undefined,
              stale: false,
              outcome,
            },
            trace,
          );
        }
      } catch (error) {
        outcome = signal.aborted ? "cancelled" : "fault";
        if (current === generation && !disposed)
          set(
            {
              ...value.get(),
              loading: false,
              error: signal.aborted ? undefined : error,
              stale: true,
              outcome,
            },
            trace,
          );
      } finally {
        if (signal.aborted) outcome = "cancelled";
        browserEvent(telemetry, def.id, "resource.finished", trace, {
          spanId,
          duration: performance.now() - start,
          outcome,
        });
      }
    },
    invalidate(trace?: TraceToken) {
      if (disposed) return Promise.resolve();
      value._trace = trace;
      value.set({ ...value.get(), stale: true });
      return resource.refresh(trace);
    },
    activate(next: WebTelemetry = silentTelemetry) {
      if (active || disposed) return;
      active = true;
      telemetry = next;
      const reload = () => {
        void resource.refresh((def.from ?? []).find((d) => d._trace)?._trace);
      };
      for (const dep of def.from ?? []) stops.push(dep.subscribe(reload));
      void resource.refresh();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      controller?.abort();
      for (const stop of stops) stop();
      for (const p of projections) p.dispose();
      originalDispose();
    },
  });
  return resource;
}
export interface ActionSnapshot<O> {
  status: "idle" | "running" | "success" | "error";
  running: boolean;
  result: O | undefined;
  error: unknown;
}
export interface Action<I, O> extends Readable<ActionSnapshot<O>> {
  running: Readable<boolean>;
  error: Readable<unknown>;
  result: Readable<O | undefined>;
  execute(input: I, ctx?: { trace?: TraceToken }): Promise<O>;
  activate(telemetry?: WebTelemetry): void;
}
export interface ActionContext {
  signal: AbortSignal;
  trace: TraceToken;
  set<T>(state: Writable<T>, value: T): void;
}
export function action<I = void, O = unknown>(def: {
  id: string;
  input?: Schema<I>;
  needs?: Record<string, GraphDefinition>;
  invalidates?: readonly WebResource<any, any>[];
  run: (input: I, ctx: ActionContext) => O | Promise<O>;
}): Action<I, O> {
  const value = state<ActionSnapshot<O>>({
      id: def.id,
      initial: {
        status: "idle",
        running: false,
        result: undefined,
        error: undefined,
      },
    }),
    originalDispose = value.dispose.bind(value);
  let telemetry = silentTelemetry,
    disposed = false,
    generation = 0;
  const controllers = new Set<AbortController>();
  const running = derive({
      id: def.id + ".running",
      from: [value],
      compute: (s) => s.running,
    }),
    error = derive({
      id: def.id + ".error",
      from: [value],
      compute: (s) => s.error,
    }),
    result = derive({
      id: def.id + ".result",
      from: [value],
      compute: (s) => s.result,
    });
  return Object.assign(value, {
    kind: "action" as const,
    runtime: "browser" as const,
    dependencies: Object.values(def.needs ?? {}),
    relations: (def.invalidates ?? []).map((to) => ({
      to,
      kind: "INVALIDATES" as const,
    })),
    running,
    error,
    result,
    activate(t: WebTelemetry = silentTelemetry) {
      telemetry = t;
    },
    async execute(input: I, options: { trace?: TraceToken } = {}) {
      if (disposed) throw new Error("Disposed action");
      const trace = options.trace ?? { traceId: identity() },
        spanId = identity(),
        start = performance.now(),
        current = ++generation,
        controller = new AbortController();
      controllers.add(controller);
      value._trace = trace;
      value.set({
        ...value.get(),
        status: "running",
        running: true,
        error: undefined,
      });
      browserEvent(telemetry, def.id, "action.started", trace, { spanId });
      let outcome: "ok" | "business_error" | "fault" | "cancelled" = "fault";
      try {
        const parsed = def.input ? def.input.parse(input) : input;
        const output = await batch(() =>
          def.run(parsed, {
            signal: controller.signal,
            trace: { traceId: trace.traceId, parentId: spanId },
            set(state, next) {
              state._trace = { traceId: trace.traceId, parentId: spanId };
              state.set(next);
            },
          }),
        );
        const response = output as any;
        outcome = controller.signal.aborted
          ? "cancelled"
          : response?.ok === false
            ? response.kind === "fault"
              ? "fault"
              : response.kind === "cancelled"
                ? "cancelled"
                : "business_error"
            : "ok";
        if (current === generation && !disposed) {
          value._trace = { traceId: trace.traceId, parentId: spanId };
          value.set({
            status: outcome === "ok" ? "success" : "error",
            running: false,
            result: output,
            error: outcome === "ok" ? undefined : output,
          });
        }
        if (outcome === "ok")
          await Promise.all(
            (def.invalidates ?? []).map((r) =>
              r.invalidate({ traceId: trace.traceId, parentId: spanId }),
            ),
          );
        return output;
      } catch (error) {
        outcome = controller.signal.aborted ? "cancelled" : "fault";
        if (current === generation && !disposed)
          value.set({
            status: "error",
            running: false,
            result: undefined,
            error,
          });
        throw error;
      } finally {
        controllers.delete(controller);
        browserEvent(telemetry, def.id, "action.finished", trace, {
          spanId,
          outcome,
          duration: performance.now() - start,
        });
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const c of controllers) c.abort();
      running.dispose();
      error.dispose();
      result.dispose();
      originalDispose();
    },
  });
}
