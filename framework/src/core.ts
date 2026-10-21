import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  Schema,
  ValidationError,
  validateSchemaMetadata,
  type Infer,
} from "./schema.js";
import {
  createQueueRuntime,
  createScheduleRuntime,
} from "./runtime-adapters.js";
import { MetricsAccumulator, type Outcome } from "./metrics.js";
import { setTimeout as delay } from "node:timers/promises";
import { analyzeGraph } from "./analysis.js";
export type Result<T = unknown, E extends string = string> =
  { ok: true; value: T } | { ok: false; error: E; details?: unknown };
export const ok = <T>(value: T): { ok: true; value: T } => ({
  ok: true,
  value,
});
export const error = <E extends string>(
  code: E,
  details?: unknown,
): { ok: false; error: E; details?: unknown } => ({
  ok: false,
  error: code,
  details,
});
export class Fault extends Error {
  constructor(
    public code: string,
    public status = 500,
    public details?: unknown,
  ) {
    super(code);
  }
}
export type Needs = Record<string, Resource<any, any>>;
type Values<N extends Needs> = {
  [K in keyof N]: N[K] extends Resource<infer T, any> ? T : never;
};
export type AsyncMethodKeys<T> = {
  [K in keyof T & string]: T[K] extends (...args: any[]) => Promise<any>
    ? K
    : never;
}[keyof T & string];
export interface Resource<T, N extends Needs = Needs> {
  kind: "resource";
  id: string;
  scope: "application" | "request";
  needs: N;
  open: (
    ctx: Values<N> & { request?: Request; signal?: AbortSignal },
  ) => T | Promise<T>;
  close?(value: T): void | Promise<void>;
  effects?: string[];
  estimateMs?: number;
  instrument?: readonly AsyncMethodKeys<T>[];
}
export function resource<T, N extends Needs = {}>(
  def: Omit<Resource<T, N>, "kind" | "needs" | "scope"> & {
    needs?: N;
    scope?: "application" | "request";
  },
): Resource<T, N> {
  return Object.freeze({
    kind: "resource",
    scope: "application",
    needs: {} as N,
    ...def,
  });
}
export const capability = resource;
export type ErrorDefinition =
  number | { status: number; details?: Schema<any> };
export type ErrorContracts = Record<string, ErrorDefinition>;
export const errorStatus = (definition: ErrorDefinition) =>
  typeof definition === "number" ? definition : definition.status;
export type BusinessError<E extends ErrorContracts> = {
  [K in keyof E & string]: E[K] extends { details: Schema<infer D> }
    ? { ok: false; error: K; details: D }
    : { ok: false; error: K; details?: unknown };
}[keyof E & string];
export type OperationResult<O, E extends ErrorContracts> =
  { ok: true; value: O } | BusinessError<E>;
export type Fail<E extends ErrorContracts> = <K extends keyof E & string>(
  code: K,
  ...details: E[K] extends { details: Schema<infer D> }
    ? [details: D]
    : [details?: unknown]
) => Extract<BusinessError<E>, { error: K }>;
export type Calls = Record<string, Operation<any, any, any, any, any>>;
export interface Operation<
  I = any,
  O = any,
  N extends Needs = Needs,
  E extends ErrorContracts = ErrorContracts,
  C extends Calls = Calls,
> {
  kind: "operation";
  id: string;
  input: Schema<I>;
  output: Schema<O>;
  needs: N;
  errors: E;
  calls: C;
  run(
    ctx: Values<N> & {
      input: I;
      signal?: AbortSignal;
      fail: Fail<E>;
      call: <K extends keyof C & string>(
        name: K,
        input: Infer<C[K]["input"]>,
      ) => Promise<OperationResult<Infer<C[K]["output"]>, C[K]["errors"]>>;
    },
  ): OperationResult<O, E> | Promise<OperationResult<O, E>>;
  effects?: string[];
  estimateMs?: number;
  budgetMs?: number;
}
export function operation<
  I,
  O,
  N extends Needs = {},
  const E extends ErrorContracts = {},
  C extends Calls = {},
>(
  def: Omit<Operation<I, O, N, E, C>, "kind" | "needs" | "errors" | "calls"> & {
    needs?: N;
    errors?: E;
    calls?: C;
  },
): Operation<I, O, N, E, C> {
  return Object.freeze({
    kind: "operation",
    needs: {} as N,
    errors: {} as E,
    calls: {} as C,
    ...def,
  });
}
export interface QueueDefinition {
  kind: "queue";
  id: string;
  operation: Operation;
  concurrency?: number;
  capacity?: number;
}
export interface ScheduleDefinition {
  kind: "schedule";
  id: string;
  operation: Operation;
  everyMs: number;
  input: () => unknown;
  onError?: (error: unknown) => void;
}
export type NodeKind =
  | "operation"
  | "resource"
  | "http-route"
  | "queue"
  | "worker"
  | "schedule"
  | "effect";
export type EdgeKind =
  "DEPENDS_ON" | "ROUTES_TO" | "CALLS" | "EMITS" | "CONSUMES" | "TRIGGERS";
export interface GraphNode {
  id: string;
  kind: NodeKind;
  [key: string]: any;
}
export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  name?: string;
}
export interface ArchitectureIR {
  version: 2;
  nodes: GraphNode[];
  edges: GraphEdge[];
  routes: { method: string; path: string; operation: string; status: number }[];
  analysis?: ReturnType<typeof analyzeGraph>;
}
export interface Route {
  method: string;
  path: string;
  operation: Operation;
  status?: number;
}
export const http = Object.fromEntries(
  ["get", "post", "put", "patch", "delete"].map((method) => [
    method,
    (
      path: string,
      operation: Operation,
      options: { status?: number } = {},
    ) => ({ method: method.toUpperCase(), path, operation, ...options }),
  ]),
) as Record<
  "get" | "post" | "put" | "patch" | "delete",
  (path: string, operation: Operation, options?: { status?: number }) => Route
>;
export const module = (def: {
  id: string;
  operations?: Operation[];
  resources?: Resource<any, any>[];
  routes?: Route[];
  queues?: QueueDefinition[];
  schedules?: ScheduleDefinition[];
}) => def;
export interface Span {
  node: string;
  id: string;
  parentId?: string;
  kind?: string;
  start: number;
  duration: number;
  status: "ok" | "error";
}
export interface Trace {
  id: string;
  operation: string;
  startedAt: string;
  duration: number;
  status: string;
  spans: Span[];
}
export const traceContext = new AsyncLocalStorage<{
  traceId: string;
  operation: string;
}>();
type AppOptions = {
  operations?: Operation[];
  resources?: Resource<any, any>[];
  routes?: Route[];
  modules?: ReturnType<typeof module>[];
  traceLimit?: number;
  metricsWindowMs?: number;
  queues?: QueueDefinition[];
  schedules?: ScheduleDefinition[];
};
export class Application {
  operations: Operation[];
  resources: Resource<any, any>[];
  routes: Route[];
  private nodes = new Map<string, Operation | Resource<any, any>>();
  private plans = new Map<Operation, Resource<any, any>[][]>();
  private rawSingletons = new Map<Resource<any, any>, any>();
  private singletons = new Map<Resource<any, any>, any>();
  private opened: Resource<any, any>[] = [];
  private state:
    "new" | "compiled" | "starting" | "started" | "closing" | "closed" = "new";
  private starting?: Promise<this>;
  private closing?: Promise<void>;
  private compileOverrides = new Map<Resource<any, any>, unknown>();
  private needed = new Set<Resource<any, any>>();
  readonly queues = new Map<string, ReturnType<typeof createQueueRuntime>>();
  readonly scheduleRuntimes = new Map<
    string,
    ReturnType<typeof createScheduleRuntime>
  >();
  queueDefinitions: QueueDefinition[];
  scheduleDefinitions: ScheduleDefinition[];
  private listeners = new Set<(event: RuntimeEvent) => void>();
  private accumulator: MetricsAccumulator;
  private active = new Set<Promise<any>>();
  traces: Trace[] = [];
  faults = new Map<
    string,
    {
      latencyMs?: number;
      errorRate?: number;
      timeoutMs?: number;
      unavailable?: boolean;
    }
  >();
  private effectContext = new AsyncLocalStorage<{
    scope: ExecutionScope;
    parentId: string;
  }>();
  constructor(private options: AppOptions) {
    if (
      options.traceLimit !== undefined &&
      (!Number.isInteger(options.traceLimit) || options.traceLimit < 0)
    )
      throw new Error("Invalid trace limit");
    this.accumulator = new MetricsAccumulator(options.metricsWindowMs ?? 60000);
    this.queueDefinitions = [
      ...(options.queues ?? []),
      ...(options.modules ?? []).flatMap((m) => m.queues ?? []),
    ];
    this.scheduleDefinitions = [
      ...(options.schedules ?? []),
      ...(options.modules ?? []).flatMap((m) => m.schedules ?? []),
    ];
    const modules = options.modules ?? [];
    this.operations = [
      ...(options.operations ?? []),
      ...modules.flatMap((m) => m.operations ?? []),
    ];
    this.resources = [
      ...(options.resources ?? []),
      ...modules.flatMap((m) => m.resources ?? []),
    ];
    this.routes = [
      ...(options.routes ?? []),
      ...modules.flatMap((m) => m.routes ?? []),
    ];
  }
  async compile(
    options: { overrides?: Map<Resource<any, any>, unknown> } = {},
  ) {
    if (this.state === "closed" || this.state === "closing")
      throw new Error("Application is closed");
    if (this.state !== "new") return this;
    const nodes = new Map<string, Operation | Resource<any, any>>();
    const visit = (
      node: Operation | Resource<any, any>,
      stack: string[] = [],
    ) => {
      if (!node || !["operation", "resource"].includes(node.kind) || !node.id)
        throw new Error("Missing or invalid dependency");
      if (stack.includes(node.id))
        throw new Error(
          `Circular dependency: ${[...stack, node.id].join(" → ")}`,
        );
      const existing = nodes.get(node.id);
      if (existing && existing !== node)
        throw new Error(`Duplicate node id: ${node.id}`);
      if (existing) return;
      if (node.kind === "operation") {
        if (!(node.input instanceof Schema) || !(node.output instanceof Schema))
          throw new Error(`Invalid schema: ${node.id}`);
        validateSchemaMetadata(node.input.json);
        validateSchemaMetadata(node.output.json);
        for (const definition of Object.values(node.errors))
          if (
            !Number.isInteger(errorStatus(definition)) ||
            errorStatus(definition) < 400 ||
            errorStatus(definition) > 599 ||
            (typeof definition !== "number" &&
              definition.details !== undefined &&
              !(definition.details instanceof Schema))
          )
            throw new Error(`Invalid error mapping: ${node.id}`);
      }
      if (
        Object.keys(node.needs).some((k) =>
          [
            "input",
            "signal",
            "request",
            "call",
            "fail",
            "__proto__",
            "constructor",
            "prototype",
          ].includes(k),
        )
      )
        throw new Error(`Reserved dependency name: ${node.id}`);
      for (const dep of Object.values(node.needs as Needs)) {
        if (dep?.kind !== "resource")
          throw new Error(`Missing dependency: ${node.id}`);
        if (
          node.kind === "resource" &&
          node.scope === "application" &&
          dep.scope === "request"
        )
          throw new Error(`Scope violation: ${node.id} → ${dep.id}`);
        visit(dep, [...stack, node.id]);
      }
      if (node.kind === "operation")
        for (const def of Object.values(node.errors))
          if (typeof def !== "number" && def.details)
            validateSchemaMetadata(def.details.json);
      if (node.kind === "operation")
        for (const child of Object.values(node.calls)) {
          if (child?.kind !== "operation")
            throw new Error(`Invalid operation call: ${node.id}`);
          visit(child, [...stack, node.id]);
        }
      if (
        node.kind === "operation" &&
        node.budgetMs !== undefined &&
        (!Number.isFinite(node.budgetMs) || node.budgetMs < 0)
      )
        throw new Error(`Invalid budget: ${node.id}`);
      if (
        node.estimateMs !== undefined &&
        (!Number.isFinite(node.estimateMs) || node.estimateMs < 0)
      )
        throw new Error(`Invalid estimate: ${node.id}`);
      nodes.set(node.id, node);
    };
    for (const node of [
      ...this.resources,
      ...this.operations,
      ...this.routes.map((r) => r.operation),
      ...this.queueDefinitions.map((q) => q.operation),
      ...this.scheduleDefinitions.map((s) => s.operation),
    ])
      visit(node);
    const paths = new Set<string>();
    for (const r of this.routes) {
      if (
        !/^\/(?:[^?#]*)$/.test(r.path) ||
        !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(
          r.method,
        )
      )
        throw new Error("Invalid route");
      const canonicalPath = r.path.replace(/\/+$/, "") || "/";
      const key = r.method + " " + canonicalPath.replace(/:[^/]+/g, ":");
      if (paths.has(key)) throw new Error(`Route collision: ${key}`);
      paths.add(key);
      if (
        r.status !== undefined &&
        (!Number.isInteger(r.status) || r.status < 200 || r.status > 299)
      )
        throw new Error("Invalid success status");
    }
    this.nodes = nodes;
    this.operations = [...nodes.values()].filter(
      (n): n is Operation => n.kind === "operation",
    );
    this.resources = [...nodes.values()].filter(
      (n): n is Resource<any, any> => n.kind === "resource",
    );
    for (const op of this.operations) {
      const levels = new Map<Resource<any, any>, number>();
      const level = (r: Resource<any, any>): number => {
        if (levels.has(r)) return levels.get(r)!;
        const l = options.overrides?.has(r)
          ? 0
          : Math.max(-1, ...Object.values(r.needs as Needs).map(level)) + 1;
        levels.set(r, l);
        return l;
      };
      Object.values(op.needs).forEach(level);
      const plan: Resource<any, any>[][] = [];
      for (const [r, l] of levels) (plan[l] ??= []).push(r);
      this.plans.set(op, plan);
    }
    const needed = new Set<Resource<any, any>>();
    const need = (r: Resource<any, any>) => {
      if (needed.has(r)) return;
      needed.add(r);
      if (!options.overrides?.has(r))
        Object.values(r.needs as Needs).forEach(need);
    };
    for (const op of this.operations) Object.values(op.needs).forEach(need);
    for (const r of [
      ...(this.options.resources ?? []),
      ...(this.options.modules ?? []).flatMap((m) => m.resources ?? []),
    ])
      need(r);
    this.needed = needed;
    this.compileOverrides = new Map(options.overrides);
    const ir = this.makeGraph();
    const ids = new Set<string>();
    for (const node of ir.nodes) {
      if (ids.has(node.id))
        throw new Error(`Duplicate architecture id: ${node.id}`);
      ids.add(node.id);
    }
    for (const q of this.queueDefinitions)
      if (
        !Number.isInteger(q.concurrency ?? 4) ||
        (q.concurrency ?? 4) < 1 ||
        !Number.isInteger(q.capacity ?? 1000) ||
        (q.capacity ?? 1000) < 1
      )
        throw new Error("Invalid queue options");
    for (const schedule of this.scheduleDefinitions)
      if (!Number.isFinite(schedule.everyMs) || schedule.everyMs < 1)
        throw new Error("Invalid schedule interval");
    for (const node of this.nodes.values()) {
      Object.freeze(node.needs);
      if (node.kind === "operation") {
        Object.freeze(node.calls);
        Object.freeze(node.errors);
      }
    }
    this.state = "compiled";
    return this;
  }
  start(): Promise<this> {
    if (this.state === "started") return Promise.resolve(this);
    if (this.state === "starting") return this.starting!;
    if (this.state !== "compiled")
      return Promise.reject(new Error("Compile application before start"));
    this.state = "starting";
    this.starting = (async () => {
      try {
        for (const r of this.resources)
          if (r.scope === "application" && this.needed.has(r)) {
            if (this.compileOverrides.has(r)) {
              this.singletons.set(r, this.compileOverrides.get(r));
              continue;
            }
            const value = await r.open(this.context(r, this.singletons));
            this.rawSingletons.set(r, value);
            this.opened.push(r);
            this.singletons.set(r, this.instrument(r, value));
            this.publish("resource.opened", r.id);
          }
        this.state = "started";
        for (const q of this.queueDefinitions)
          this.queues.set(
            q.id,
            createQueueRuntime(this, q, (input) =>
              this.runAccepted(q.operation.id, input),
            ),
          );
        for (const schedule of this.scheduleDefinitions)
          this.scheduleRuntimes.set(
            schedule.id,
            createScheduleRuntime(this, schedule),
          );
        return this;
      } catch (e) {
        let cleanup: unknown;
        try {
          await this.dispose(this.opened, this.rawSingletons);
        } catch (failure) {
          cleanup = failure;
        } finally {
          this.opened = [];
          this.singletons.clear();
          this.rawSingletons.clear();
          this.state = "compiled";
        }
        if (cleanup)
          throw new AggregateError(
            [e, cleanup],
            "Activation and rollback failed",
          );
        throw e;
      }
    })();
    return this.starting;
  }
  activate() {
    return this.start();
  }
  subscribe(listener: (event: RuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  publish(type: string, node: string, data?: unknown) {
    const event = { type, node, time: Date.now(), data };
    for (const listener of this.listeners)
      try {
        listener(event);
      } catch {
        /* Observers cannot break execution. */
      }
  }
  registerQueue(def: QueueDefinition) {
    if (this.state === "new") {
      this.queueDefinitions.push(def);
      return;
    }
    throw new Error("Declare queues before compile");
  }
  registerSchedule(def: ScheduleDefinition) {
    if (this.state === "new") {
      this.scheduleDefinitions.push(def);
      return;
    }
    throw new Error("Declare schedules before compile");
  }
  attachQueue(def: QueueDefinition) {
    this.validateTransport(def.id, def.operation);
    if (
      !Number.isInteger(def.concurrency ?? 4) ||
      (def.concurrency ?? 4) < 1 ||
      !Number.isInteger(def.capacity ?? 1000) ||
      (def.capacity ?? 1000) < 1
    )
      throw new Error("Invalid queue options");
    this.queueDefinitions.push(def);
    const runtime = createQueueRuntime(this, def, (input) =>
      this.runAccepted(def.operation.id, input),
    );
    this.queues.set(def.id, runtime);
    this.publish("graph.updated", def.id);
    return runtime;
  }
  attachSchedule(def: ScheduleDefinition) {
    this.validateTransport(def.id, def.operation);
    if (!Number.isFinite(def.everyMs) || def.everyMs < 1)
      throw new Error("Invalid schedule interval");
    this.scheduleDefinitions.push(def);
    const runtime = createScheduleRuntime(this, def);
    this.scheduleRuntimes.set(def.id, runtime);
    this.publish("graph.updated", def.id);
    return runtime;
  }
  private validateTransport(id: string, op: Operation) {
    if (this.state !== "started")
      throw new Error("Start application before attaching runtime transport");
    if (this.nodes.get(op.id) !== op)
      throw new Error("Transport operation must be compiled");
    if (
      !id ||
      this.makeGraph().nodes.some((n) => n.id === id || n.id === `worker:${id}`)
    )
      throw new Error("Duplicate transport id");
  }
  private instrument(r: Resource<any, any>, value: any) {
    if (!r.instrument?.length) return value;
    for (const name of r.instrument)
      if (typeof value?.[name] !== "function")
        throw new Error(`Invalid instrumented method: ${r.id}.${name}`);
    return new Proxy(value, {
      get: (target, name, receiver) => {
        if (typeof name !== "string" || !r.instrument!.includes(name))
          return Reflect.get(target, name, receiver);
        return (...args: any[]) => {
          const node = `${r.id}.${name}`,
            context = this.effectContext.getStore();
          const invoke = async () => Reflect.apply(target[name], target, args);
          if (context) {
            if (context.scope.ended)
              return Promise.reject(new Error("Execution context is closed"));
            const task = this.withSpan(
              node,
              "effect",
              context.scope,
              context.parentId,
              () => invoke(),
            );
            context.scope.pending.add(task);
            void task
              .finally(() => context.scope.pending.delete(task))
              .catch(() => {});
            return task;
          }
          return invoke();
        };
      },
    });
  }
  private context(
    node: { needs: Needs },
    values: Map<Resource<any, any>, any>,
  ) {
    return Object.fromEntries(
      Object.entries(node.needs).map(([k, r]) => [k, values.get(r)]),
    ) as any;
  }
  private async dispose(
    resources: Resource<any, any>[],
    values: Map<Resource<any, any>, any>,
  ) {
    const errors: unknown[] = [];
    for (const r of [...resources].reverse())
      try {
        await r.close?.(values.get(r));
        this.publish("resource.closed", r.id);
      } catch (e) {
        errors.push(e);
      }
    if (errors.length)
      throw new AggregateError(errors, "Resource cleanup failed");
  }
  execute(
    id: string,
    input: unknown,
    options: ExecutionOptions = {},
  ): Promise<Result> {
    if (this.state !== "started")
      return Promise.reject(new Error("Start application before execution"));
    return this.runAccepted(id, input, options);
  }
  private runAccepted(
    id: string,
    input: unknown,
    options: ExecutionOptions = {},
  ): Promise<Result> {
    const op = this.nodes.get(id);
    if (op?.kind !== "operation")
      return Promise.reject(new Fault("OPERATION_NOT_FOUND", 404));
    const task = this.executeRoot(op, input, options);
    this.active.add(task);
    void task.finally(() => this.active.delete(task)).catch(() => {});
    return task;
  }
  private async executeRoot(
    op: Operation,
    input: unknown,
    options: ExecutionOptions,
  ): Promise<Result> {
    const started = performance.now();
    const trace: Trace = {
      id: randomUUID(),
      operation: op.id,
      startedAt: new Date().toISOString(),
      duration: 0,
      status: "ok",
      spans: [],
    };
    const scope: ExecutionScope = {
      trace,
      started,
      options,
      values: new Map(this.singletons),
      resolving: new Map(),
      opened: new Set(),
      pending: new Set(),
      ended: false,
    };
    let result: Result | undefined;
    let failure: unknown;
    let failed = false;
    try {
      result = await this.invoke(op, input, scope, undefined, []);
    } catch (e) {
      failed = true;
      failure = e;
    }
    // Detached calls are joined before cleanup; no resource can open after disposal.
    while (scope.pending.size) await Promise.allSettled([...scope.pending]);
    await Promise.allSettled([...scope.resolving.values()]);
    scope.ended = true;
    try {
      await this.dispose(
        this.resources.filter((r) => scope.opened.has(r)),
        scope.values,
      );
    } catch (e) {
      failure = failed
        ? new AggregateError([failure, e], "Execution and cleanup failed")
        : e;
      failed = true;
    }
    trace.duration = performance.now() - started;
    trace.status = failed
      ? options.signal?.aborted
        ? "cancelled"
        : failure instanceof Fault
          ? failure.code
          : "fault"
      : result?.ok
        ? "ok"
        : ((result as any)?.error ?? "fault");
    const outcome: Outcome = failed
      ? options.signal?.aborted
        ? "cancelled"
        : "fault"
      : (scope.rootOutcome ?? "fault");
    if (scope.rootMetric) this.accumulator.end(scope.rootMetric, outcome);
    this.publish("operation.finished", op.id, { traceId: trace.id, outcome });
    this.publish("metrics.updated", op.id);
    this.traces.push(trace);
    while (this.traces.length > (this.options.traceLimit ?? 500))
      this.traces.shift();
    if (failed) throw failure;
    return result!;
  }
  private resolve(
    r: Resource<any, any>,
    scope: ExecutionScope,
    parentId: string,
  ): Promise<any> {
    if (scope.resolving.has(r)) return scope.resolving.get(r)!;
    const task = (async () => {
      if (scope.options.overrides?.has(r))
        return scope.options.overrides.get(r);
      if (this.compileOverrides.has(r)) return this.compileOverrides.get(r);
      if (r.scope === "application") return scope.values.get(r);
      scope.options.signal?.throwIfAborted();
      await Promise.all(
        Object.values(r.needs as Needs).map((dep) =>
          this.resolve(dep, scope, parentId),
        ),
      );
      scope.options.signal?.throwIfAborted();
      const value = await this.withSpan(
        r.id,
        "resource.open",
        scope,
        parentId,
        () =>
          r.open({
            ...this.context(r, scope.values),
            request: scope.options.request,
            signal: scope.options.signal,
          }),
      );
      scope.values.set(r, value);
      scope.opened.add(r);
      this.publish("resource.opened", r.id, { traceId: scope.trace.id });
      return value;
    })().then((value) => {
      scope.values.set(r, value);
      return value;
    });
    scope.resolving.set(r, task);
    return task;
  }
  private async withSpan<T>(
    node: string,
    kind: string,
    scope: ExecutionScope,
    parentId: string | undefined,
    fn: (id: string) => T | Promise<T>,
  ): Promise<T> {
    const id = randomUUID(),
      start = performance.now();
    let status: "ok" | "error" = "ok";
    try {
      const fault = this.faults.get(node);
      if (fault?.unavailable) throw new Fault("INJECTED_UNAVAILABLE", 503);
      if (fault?.timeoutMs) {
        await delay(fault.timeoutMs, undefined, {
          signal: scope.options.signal,
        });
        throw new Fault("INJECTED_TIMEOUT", 504);
      }
      if (fault?.latencyMs)
        await delay(fault.latencyMs, undefined, {
          signal: scope.options.signal,
        });
      if (Math.random() < (fault?.errorRate ?? 0))
        throw new Fault("INJECTED_FAILURE", 503);
      scope.options.signal?.throwIfAborted();
      return await this.effectContext.run({ scope, parentId: id }, () =>
        fn(id),
      );
    } catch (e) {
      status = "error";
      throw e;
    } finally {
      scope.trace.spans.push({
        id,
        parentId,
        node,
        kind,
        start: start - scope.started,
        duration: performance.now() - start,
        status,
      });
    }
  }
  private async invoke(
    op: Operation,
    input: unknown,
    scope: ExecutionScope,
    parentId: string | undefined,
    stack: string[],
  ): Promise<Result> {
    if (scope.ended) throw new Error("Execution context is closed");
    if (stack.includes(op.id)) throw new Fault("RECURSIVE_CALL", 500);
    const metric = this.accumulator.begin(op.id);
    if (!parentId) scope.rootMetric = metric;
    let outcome: Outcome = "fault";
    this.publish("operation.started", op.id, { traceId: scope.trace.id });
    try {
      return await this.withSpan(
        op.id,
        "operation",
        scope,
        parentId,
        async (spanId) =>
          traceContext.run(
            { traceId: scope.trace.id, operation: op.id },
            async () => {
              let parsed;
              try {
                parsed = op.input.parse(input);
              } catch (e) {
                if (e instanceof ValidationError)
                  throw new Fault("VALIDATION_ERROR", 400, e.issues);
                throw e;
              }
              const dependencies = await Promise.allSettled(
                Object.values(op.needs).map((r) =>
                  this.resolve(r, scope, spanId),
                ),
              );
              const failure = dependencies.find((d) => d.status === "rejected");
              if (failure?.status === "rejected") throw failure.reason;
              scope.options.signal?.throwIfAborted();
              const call = (
                name: string,
                childInput: unknown,
              ): Promise<Result> => {
                const child = Object.hasOwn(op.calls, name)
                  ? op.calls[name]
                  : undefined;
                if (!child)
                  return Promise.reject(new Fault("UNDECLARED_CALL", 500));
                const task = this.invoke(child, childInput, scope, spanId, [
                  ...stack,
                  op.id,
                ]);
                scope.pending.add(task);
                void task
                  .finally(() => scope.pending.delete(task))
                  .catch(() => {});
                return task;
              };
              const fail = (code: string, details?: unknown) =>
                error(code, details);
              const result = await this.effectContext.run(
                { scope, parentId: spanId },
                () =>
                  op.run({
                    ...this.context(op, scope.values),
                    input: parsed,
                    signal: scope.options.signal,
                    call,
                    fail,
                  } as any),
              );
              scope.options.signal?.throwIfAborted();
              if (!result || typeof result.ok !== "boolean")
                throw new Fault("INVALID_RESULT", 500);
              if (result.ok) {
                let value;
                try {
                  value = op.output.parse(result.value);
                } catch {
                  throw new Fault("INVALID_OUTPUT", 500);
                }
                outcome = "ok";
                return ok(value);
              }
              if (!Object.hasOwn(op.errors, result.error))
                throw new Fault("UNDECLARED_ERROR", 500);
              const definition = op.errors[result.error];
              if (typeof definition !== "number" && definition.details) {
                try {
                  result.details = definition.details.parse(result.details);
                } catch {
                  throw new Fault("INVALID_ERROR_DETAILS", 500);
                }
              }
              outcome = "business_error";
              return result;
            },
          ),
      );
    } catch (e) {
      if (scope.options.signal?.aborted) outcome = "cancelled";
      throw e;
    } finally {
      if (parentId) {
        this.accumulator.end(metric, outcome);
        this.publish("operation.finished", op.id, {
          traceId: scope.trace.id,
          outcome,
        });
        this.publish("metrics.updated", op.id);
      } else scope.rootOutcome = outcome;
    }
  }
  private makeGraph(): ArchitectureIR {
    return {
      version: 2,
      nodes: [
        ...[...this.nodes.values()].map((n): GraphNode => ({
          id: n.id,
          kind: n.kind,
          scope: n.kind === "resource" ? n.scope : undefined,
          effects: n.effects ?? [],
          estimateMs: n.estimateMs ?? null,
          ...(n.kind === "operation"
            ? {
                input: n.input.json,
                output: n.output.json,
                errors: Object.fromEntries(
                  Object.entries(n.errors).map(([code, def]) => [
                    code,
                    {
                      status: errorStatus(def),
                      ...(typeof def !== "number" && def.details
                        ? { details: def.details.json }
                        : {}),
                    },
                  ]),
                ),
                budgetMs: n.budgetMs ?? null,
                plan: {
                  scheduler: "dependency-ready",
                  resources: this.plans
                    .get(n)
                    ?.flat()
                    .map((r) => ({
                      id: r.id,
                      dependencies: Object.values(r.needs as Needs).map(
                        (dep) => dep.id,
                      ),
                    })),
                },
              }
            : {}),
        })),
        ...this.routes.map((r) => ({
          id: `http:${r.method}:${r.path}`,
          kind: "http-route" as const,
          method: r.method,
          path: r.path,
        })),
        ...this.queueDefinitions.flatMap((q) => [
          { id: q.id, kind: "queue" as const, capacity: q.capacity ?? 1000 },
          {
            id: `worker:${q.id}`,
            kind: "worker" as const,
            concurrency: q.concurrency ?? 4,
          },
        ]),
        ...this.scheduleDefinitions.map((s) => ({
          id: s.id,
          kind: "schedule" as const,
          everyMs: s.everyMs,
        })),
        ...this.resources.flatMap((r) =>
          (r.instrument ?? []).map((method) => ({
            id: `${r.id}.${method}`,
            kind: "effect" as const,
            resource: r.id,
            method,
          })),
        ),
      ],
      edges: [
        ...[...this.nodes.values()].flatMap((n) =>
          Object.entries(n.needs as Needs).map(([name, r]) => ({
            from: n.id,
            to: r.id,
            name,
            kind: "DEPENDS_ON" as const,
          })),
        ),
        ...this.operations.flatMap((op) =>
          Object.entries(op.calls).map(([name, child]) => ({
            from: op.id,
            to: child.id,
            name,
            kind: "CALLS" as const,
          })),
        ),
        ...this.routes.map((r) => ({
          from: `http:${r.method}:${r.path}`,
          to: r.operation.id,
          kind: "ROUTES_TO" as const,
        })),
        ...this.queueDefinitions.flatMap((q) => [
          { from: `worker:${q.id}`, to: q.id, kind: "CONSUMES" as const },
          {
            from: `worker:${q.id}`,
            to: q.operation.id,
            kind: "CALLS" as const,
          },
        ]),
        ...this.scheduleDefinitions.map((s) => ({
          from: s.id,
          to: s.operation.id,
          kind: "TRIGGERS" as const,
        })),
        ...this.resources.flatMap((r) =>
          (r.instrument ?? []).map((method) => ({
            from: r.id,
            to: `${r.id}.${method}`,
            kind: "CALLS" as const,
          })),
        ),
      ],
      routes: this.routes.map((r) => ({
        method: r.method,
        path: r.path,
        operation: r.operation.id,
        status: r.status ?? 200,
      })),
    };
  }
  graph(): ArchitectureIR {
    const ir = this.makeGraph();
    return { ...ir, analysis: analyzeGraph(ir) };
  }
  metrics() {
    return this.accumulator.snapshot(this.operations.map((op) => op.id));
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.publish("application.stopping", "application");
    this.closing = (async () => {
      if (this.state === "starting") await this.starting?.catch(() => {});
      if (this.state === "closed") return;
      // Drain adapters while their already accepted jobs can still execute.
      this.state = "closing";
      for (const timer of this.scheduleRuntimes.values()) await timer.close();
      await Promise.all([...this.queues.values()].map((q) => q.close()));
      await Promise.allSettled([...this.active]);
      try {
        await this.dispose(this.opened, this.rawSingletons);
      } finally {
        this.opened = [];
        this.singletons.clear();
        this.rawSingletons.clear();
        this.state = "closed";
      }
    })();
    return this.closing;
  }
}
export interface RuntimeEvent {
  type: string;
  node: string;
  time: number;
  data?: unknown;
}
export interface ExecutionOptions {
  request?: Request;
  signal?: AbortSignal;
  overrides?: Map<Resource<any, any>, unknown>;
}
interface ExecutionScope {
  rootMetric?: { id: string; started: number };
  rootOutcome?: Outcome;
  trace: Trace;
  started: number;
  options: ExecutionOptions;
  values: Map<Resource<any, any>, any>;
  resolving: Map<Resource<any, any>, Promise<any>>;
  opened: Set<Resource<any, any>>;
  pending: Set<Promise<any>>;
  ended: boolean;
}
export const application = (options: AppOptions) => new Application(options);
export function test(op: Operation) {
  const overrides = new Map<Resource<any, any>, unknown>();
  return {
    provide<T>(r: Resource<T, any>, value: T) {
      overrides.set(r, value);
      return this;
    },
    async run(input: unknown, options: ExecutionOptions = {}) {
      const app = application({ operations: [op] });
      await app.compile({ overrides });
      try {
        await app.start();
        return await app.execute(op.id, input, { ...options, overrides });
      } finally {
        await app.close();
      }
    },
  };
}
