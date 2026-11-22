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
  signal,
  derive,
  batch,
  type Computed,
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
export const captureResourceUpdate = Symbol("ARC resource update");

export interface WebResource<T, I = unknown> extends Readable<
  ResourceSnapshot<T>
> {
  data: Computed<T | undefined>;
  loading: Computed<boolean>;
  error: Computed<unknown>;
  stale: Computed<boolean>;
  refresh(trace?: TraceToken): Promise<void>;
  invalidate(trace?: TraceToken): Promise<void>;
  activate(telemetry?: WebTelemetry): void;
  dispose(): void;
  relations?: GraphDefinition["relations"];
  [captureResourceUpdate]?: () => (update: (data: T) => T, trace: TraceToken) => void;
}
type WebResourceOptions<T, I> = {
  id: string;
  from?: readonly Readable<any>[];
  input?: (...values: any[]) => I;
  load: (
    input: I,
    ctx: { signal: AbortSignal; trace: TraceToken },
  ) => Promise<T>;
  result?: boolean;
  scope?: "application" | "view";
  callable?: boolean;
  key?: () => string | number;
  cache?: boolean;
};

const queryCacheLimit = 32;

export function webResource<T, I = unknown>(
  def: WebResourceOptions<T, I> & { callable: true },
): WebResource<T, I> & (() => ResourceSnapshot<T>);
export function webResource<T, I = unknown>(def: WebResourceOptions<T, I>): WebResource<T, I>;
export function webResource<T, I = unknown>(def: WebResourceOptions<T, I>): WebResource<T, I> {
  const createValue = def.callable ? signal : state;
  const initial: ResourceSnapshot<T> = {
    input: undefined,
    data: undefined,
    loading: false,
    error: undefined,
    stale: true,
    outcome: "idle",
  };
  const value = createValue<ResourceSnapshot<T>>({
    id: def.id,
    initial,
  });
  let generation = 0,
    controller: AbortController | undefined,
    disposed = false,
    active = false,
    telemetry: WebTelemetry = silentTelemetry;
  const stops: (() => void)[] = [];
  const originalDispose = value.dispose.bind(value);
  const readSnapshot = value.get.bind(value);
  const key = def.key;
  if (def.cache && !key) throw new TypeError("A cached query requires a key");
  const cache = def.cache ? new Map<string | number, ResourceSnapshot<T>>() : undefined;
  function remember(requestKey: string | number, snapshot: ResourceSnapshot<T>) {
    if (!cache) return;
    cache.delete(requestKey);
    cache.set(requestKey, snapshot);
    if (cache.size > queryCacheLimit) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  let snapshotKey: string | number | undefined;
  let pendingRead: { key: typeof snapshotKey; updates: ((data: T) => T)[] } | undefined;
  if (key) {
    const switching = { ...initial, loading: true };
    value.get = () => {
      const snapshot = readSnapshot();
      if (active || snapshotKey !== undefined) {
        const currentKey = key();
        if (!Object.is(snapshotKey, currentKey))
          return active ? cache?.get(currentKey) ?? switching : initial;
      }
      return snapshot;
    };
  }
  const projectionSources = key ? [value, ...(def.from ?? [])] as const : [value] as const;
  const projections = [
    derive({ id: def.id + ".data", from: projectionSources, compute: (s) => s.data }),
    derive({
      id: def.id + ".loading",
      from: projectionSources,
      compute: (s) => s.loading,
    }),
    derive({ id: def.id + ".error", from: projectionSources, compute: (s) => s.error }),
    derive({ id: def.id + ".stale", from: projectionSources, compute: (s) => s.stale }),
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
    data: projections[0] as Computed<T | undefined>,
    loading: projections[1] as Computed<boolean>,
    error: projections[2] as Computed<unknown>,
    stale: projections[3] as Computed<boolean>,
    [captureResourceUpdate]() {
      const targetKey = key?.();
      return (update: (data: T) => T, trace: TraceToken) => {
        if (disposed) return;
        if (pendingRead && Object.is(pendingRead.key, targetKey))
          pendingRead.updates.push(update);
        if (targetKey !== undefined) {
          const cached = cache?.get(targetKey);
          if (cached?.data !== undefined) {
            const data = update(cached.data);
            if (!Object.is(data, cached.data)) remember(targetKey, { ...cached, data });
          }
        }
        if (Object.is(snapshotKey, targetKey)) {
          const snapshot = readSnapshot();
          if (snapshot.data !== undefined) {
            const data = update(snapshot.data);
            if (!Object.is(data, snapshot.data)) set({ ...snapshot, data }, trace);
          }
        }
      };
    },
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
      browserEvent(telemetry, def.id, "resource.started", trace, { spanId });
      let outcome: ResourceSnapshot<T>["outcome"] = "fault";
      let requestKey: string | number | undefined;
      let keyResolved = false;
      const updates: ((data: T) => T)[] = [];
      const currentRequest = () => !signal.aborted && current === generation &&
        !disposed && (!keyResolved || Object.is(requestKey, key?.()));
      try {
        requestKey = key?.();
        keyResolved = true;
        pendingRead = { key: requestKey, updates };
        const cached = requestKey === undefined ? undefined : cache?.get(requestKey);
        if (cached && requestKey !== undefined) remember(requestKey, cached);
        const previous = Object.is(snapshotKey, requestKey) ? readSnapshot() : cached ?? initial;
        snapshotKey = requestKey;
        set({ ...previous, loading: true, error: undefined, stale: true }, trace);
        input = def.input
          ? def.input(...(def.from ?? []).map((d) => d.get()))
          : ({} as I);
        const loaded: any = await def.load(input, {
          signal,
          trace: childTrace,
        });
        if (!currentRequest()) {
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
              ...readSnapshot(),
              loading: false,
              error: loaded,
              stale: false,
              outcome,
            },
            trace,
          );
        } else {
          outcome = "ok";
          const next = {
            input,
            data: updates.reduce((data, update) => update(data), def.result ? loaded.value : loaded),
            loading: false,
            error: undefined,
            stale: false,
            outcome,
          };
          if (requestKey !== undefined)
            remember(requestKey, { ...next, loading: true, stale: true });
          set(next, trace);
        }
      } catch (error) {
        outcome = currentRequest() ? "fault" : "cancelled";
        if (outcome === "fault")
          set(
            {
              ...(keyResolved ? readSnapshot() : initial),
              loading: false,
              error: signal.aborted ? undefined : error,
              stale: true,
              outcome,
            },
            trace,
          );
      } finally {
        if (pendingRead?.updates === updates) pendingRead = undefined;
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
      cache?.clear();
      pendingRead = undefined;
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
  submitForm?(form: HTMLFormElement, ctx: { trace: TraceToken }): Promise<O>;
  activate(telemetry?: WebTelemetry): void;
}
export type CallableAction<I, O> = Action<I, O> & (() => ActionSnapshot<O>);
export interface ActionContext {
  signal: AbortSignal;
  trace: TraceToken;
  set<T>(state: Writable<T>, value: T): void;
}
export type ActionOptions<I, O> = {
  id: string;
  input?: Schema<I>;
  needs?: Record<string, GraphDefinition>;
  invalidates?: readonly WebResource<any, any>[];
  run: (input: I, ctx: ActionContext) => O | Promise<O>;
  callable?: boolean;
};

export function action<I = void, O = unknown>(
  def: ActionOptions<I, O> & { callable: true },
): CallableAction<I, O>;
export function action<I = void, O = unknown>(def: ActionOptions<I, O>): Action<I, O>;
export function action<I = void, O = unknown>(def: ActionOptions<I, O>): Action<I, O> {
  const createValue = def.callable ? signal : state;
  const value = createValue<ActionSnapshot<O>>({
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
