import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Schema, ValidationError } from "./schema.ts";
export type Result<T = unknown, E extends string = string> =
  { ok: true; value: T } | { ok: false; error: E; details?: unknown };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const error = <E extends string>(
  code: E,
  details?: unknown,
): Result<never, E> => ({ ok: false, error: code, details });
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
export interface Operation<I = any, O = any, N extends Needs = Needs> {
  kind: "operation";
  id: string;
  input: Schema<I>;
  output: Schema<O>;
  needs: N;
  errors: Record<string, number>;
  run(
    ctx: Values<N> & { input: I; signal?: AbortSignal },
  ): Result<O> | Promise<Result<O>>;
  effects?: string[];
  estimateMs?: number;
}
export function operation<I, O, N extends Needs = {}>(
  def: Omit<Operation<I, O, N>, "kind" | "needs" | "errors"> & {
    needs?: N;
    errors?: Record<string, number>;
  },
): Operation<I, O, N> {
  return Object.freeze({
    kind: "operation",
    needs: {} as N,
    errors: {},
    ...def,
  });
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
}) => def;
export interface Span {
  node: string;
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
};
export class Application {
  operations: Operation[];
  resources: Resource<any, any>[];
  routes: Route[];
  private nodes = new Map<string, Operation | Resource<any, any>>();
  private plans = new Map<Operation, Resource<any, any>[][]>();
  private singletons = new Map<Resource<any, any>, any>();
  private opened: Resource<any, any>[] = [];
  private state: "new" | "compiled" | "closed" = "new";
  private active = new Set<Promise<any>>();
  traces: Trace[] = [];
  faults = new Map<string, { latencyMs?: number; errorRate?: number }>();
  constructor(private options: AppOptions) {
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
    if (this.state === "compiled") return this;
    if (this.state === "closed") throw new Error("Application is closed");
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
        for (const status of Object.values(node.errors))
          if (!Number.isInteger(status) || status < 400 || status > 599)
            throw new Error(`Invalid error mapping: ${node.id}`);
      }
      if (
        Object.keys(node.needs).some((k) =>
          [
            "input",
            "signal",
            "request",
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
      nodes.set(node.id, node);
    };
    for (const node of [
      ...this.resources,
      ...this.operations,
      ...this.routes.map((r) => r.operation),
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
      const key = r.method + " " + r.path.replace(/:[^/]+/g, ":");
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
    try {
      for (const r of this.resources)
        if (r.scope === "application" && needed.has(r)) {
          if (options.overrides?.has(r)) {
            this.singletons.set(r, options.overrides.get(r));
            continue;
          }
          const value = await r.open(this.context(r, this.singletons));
          this.singletons.set(r, value);
          this.opened.push(r);
        }
    } catch (e) {
      await this.dispose(this.opened, this.singletons);
      this.opened = [];
      this.singletons.clear();
      throw e;
    }
    this.state = "compiled";
    return this;
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
      } catch (e) {
        errors.push(e);
      }
    if (errors.length)
      throw new AggregateError(errors, "Resource cleanup failed");
  }
  execute(
    id: string,
    input: unknown,
    options: {
      request?: Request;
      signal?: AbortSignal;
      overrides?: Map<Resource<any, any>, unknown>;
    } = {},
  ): Promise<Result> {
    if (this.state !== "compiled")
      return Promise.reject(new Error("Compile application before execution"));
    const task = this.invoke(id, input, options);
    this.active.add(task);
    void task.finally(() => this.active.delete(task)).catch(() => {});
    return task;
  }
  private async invoke(
    id: string,
    input: unknown,
    options: {
      request?: Request;
      signal?: AbortSignal;
      overrides?: Map<Resource<any, any>, unknown>;
    },
  ): Promise<Result> {
    const op = this.nodes.get(id);
    if (op?.kind !== "operation") throw new Fault("OPERATION_NOT_FOUND", 404);
    const trace: Trace = {
      id: randomUUID(),
      operation: id,
      startedAt: new Date().toISOString(),
      duration: 0,
      status: "ok",
      spans: [],
    };
    const started = performance.now();
    const values = new Map(this.singletons);
    const opened: Resource<any, any>[] = [];
    const span = async <T>(node: string, fn: () => T | Promise<T>) => {
      const start = performance.now();
      let status: "ok" | "error" = "ok";
      try {
        const fault = this.faults.get(node);
        if (fault?.latencyMs)
          await new Promise((r) => setTimeout(r, fault.latencyMs));
        if (Math.random() < (fault?.errorRate ?? 0))
          throw new Fault("INJECTED_FAILURE", 503);
        return await fn();
      } catch (e) {
        status = "error";
        throw e;
      } finally {
        trace.spans.push({
          node,
          start: start - started,
          duration: performance.now() - start,
          status,
        });
      }
    };
    return traceContext.run({ traceId: trace.id, operation: id }, async () => {
      try {
        const parsed = op.input.parse(input);
        for (const layer of this.plans.get(op)!) {
          const settled = await Promise.allSettled(
            layer.map(async (r) => {
              if (options.overrides?.has(r)) {
                values.set(r, options.overrides.get(r));
                return;
              }
              if (r.scope === "application") return;
              const value = await span(r.id, () =>
                r.open({
                  ...this.context(r, values),
                  request: options.request,
                  signal: options.signal,
                }),
              );
              values.set(r, value);
              opened.push(r);
            }),
          );
          const failed = settled.find((x) => x.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
        }
        options.signal?.throwIfAborted();
        const result = await span(op.id, () =>
          op.run({
            ...this.context(op, values),
            input: parsed,
            signal: options.signal,
          }),
        );
        if (!result || typeof result.ok !== "boolean")
          throw new Error(`Invalid result: ${id}`);
        if (result.ok) {
          try {
            return ok(op.output.parse(result.value));
          } catch (e) {
            throw new Fault("INVALID_OUTPUT", 500);
          }
        }
        if (!Object.hasOwn(op.errors, result.error))
          throw new Error(`Undeclared error: ${result.error}`);
        trace.status = result.error;
        return result;
      } catch (e) {
        trace.status = e instanceof Fault ? e.code : "error";
        if (e instanceof ValidationError)
          throw new Fault("VALIDATION_ERROR", 400, e.issues);
        throw e;
      } finally {
        try {
          await this.dispose(opened, values);
        } catch (e) {
          trace.status = "cleanup_error";
          throw e;
        } finally {
          trace.duration = performance.now() - started;
          this.traces.push(trace);
          if (this.traces.length > (this.options.traceLimit ?? 500))
            this.traces.shift();
        }
      }
    });
  }
  graph() {
    return {
      version: 1,
      nodes: [...this.nodes.values()].map((n) => ({
        id: n.id,
        kind: n.kind,
        scope: n.kind === "resource" ? n.scope : undefined,
        effects: n.effects ?? [],
        estimateMs: n.estimateMs ?? null,
        ...(n.kind === "operation"
          ? {
              input: n.input.json,
              output: n.output.json,
              errors: n.errors,
              sample: n.input.sample(),
              plan: this.plans.get(n)?.map((l) => l.map((r) => r.id)),
            }
          : {}),
      })),
      edges: [...this.nodes.values()].flatMap((n) =>
        Object.entries(n.needs as Needs).map(([name, r]) => ({
          from: n.id,
          to: r.id,
          name,
        })),
      ),
      routes: this.routes.map((r) => ({
        method: r.method,
        path: r.path,
        operation: r.operation.id,
        status: r.status ?? 200,
      })),
    };
  }
  metrics() {
    return this.operations.map((op) => {
      const t = this.traces.filter((t) => t.operation === op.id);
      const d = t.map((t) => t.duration).sort((a, b) => a - b);
      return {
        id: op.id,
        count: t.length,
        rpm: t.filter((t) => Date.now() - Date.parse(t.startedAt) < 60000)
          .length,
        errors: t.filter((t) => t.status !== "ok").length,
        p50: d[Math.floor(d.length * 0.5)] ?? 0,
        p95: d[Math.min(d.length - 1, Math.floor(d.length * 0.95))] ?? 0,
      };
    });
  }
  async close() {
    if (this.state === "closed") return;
    this.state = "closed";
    await Promise.allSettled([...this.active]);
    await this.dispose(this.opened, this.singletons);
    this.opened = [];
    this.singletons.clear();
  }
}
export const application = (options: AppOptions) => new Application(options);
export function test(op: Operation) {
  const overrides = new Map<Resource<any, any>, unknown>();
  return {
    provide<T>(r: Resource<T, any>, value: T) {
      overrides.set(r, value);
      return this;
    },
    async run(input: unknown) {
      const app = application({ operations: [op] });
      await app.compile({ overrides });
      try {
        return await app.execute(op.id, input, { overrides });
      } finally {
        await app.close();
      }
    },
  };
}
