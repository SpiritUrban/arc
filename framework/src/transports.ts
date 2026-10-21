import { Application, Fault, type Operation, type Result } from "./core.ts";
import type { Infer } from "./schema.ts";

/** Explicit JSON-RPC exposure; operation identifiers are never exposed implicitly. */
export function rpc(app: Application, methods: Record<string, Operation>) {
  return async (request: Request): Promise<Response> => {
    let id: unknown = null;
    try {
      if (request.method !== "POST") throw new Fault("METHOD_NOT_ALLOWED", 405);
      let message: any;
      try {
        message = await request.json();
      } catch {
        return Response.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32700, message: "Parse error" },
        });
      }
      id = message?.id ?? null;
      if (
        !message ||
        message.jsonrpc !== "2.0" ||
        typeof message.method !== "string"
      )
        return Response.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32600, message: "Invalid Request" },
        });
      const op = Object.hasOwn(methods, message.method)
        ? methods[message.method]
        : undefined;
      if (!op)
        return Response.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Method not found" },
        });
      const result = await app.execute(op.id, message.params ?? {}, {
        request,
        signal: request.signal,
      });
      const response = result.ok
        ? { jsonrpc: "2.0", id, result: result.value }
        : {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32000,
              message: result.error,
              data: result.details,
            },
          };
      return message.id === undefined
        ? new Response(null, { status: 204 })
        : Response.json(response);
    } catch (e) {
      return Response.json({
        jsonrpc: "2.0",
        id,
        error: {
          code: e instanceof Fault && e.status === 400 ? -32602 : -32603,
          message: e instanceof Fault ? e.code : "Internal error",
        },
      });
    }
  };
}

/** An in-memory bounded queue adapter. Durability belongs to an external adapter. */
export function queue(
  app: Application,
  op: Operation,
  options: { concurrency?: number; capacity?: number } = {},
) {
  const concurrency = options.concurrency ?? 4,
    capacity = options.capacity ?? 1000;
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    !Number.isInteger(capacity) ||
    capacity < 1
  )
    throw new Error("Invalid queue options");
  const pending: {
    input: unknown;
    resolve: (value: Result) => void;
    reject: (error: unknown) => void;
  }[] = [];
  let running = 0,
    completed = 0,
    failed = 0,
    closed = false;
  const drains: (() => void)[] = [];
  const pump = () => {
    while (running < concurrency && pending.length) {
      const job = pending.shift()!;
      running++;
      void app
        .execute(op.id, job.input)
        .then(
          (value) => {
            completed++;
            if (!value.ok) failed++;
            job.resolve(value);
          },
          (reason) => {
            failed++;
            job.reject(reason);
          },
        )
        .finally(() => {
          running--;
          pump();
        });
    }
    if (!running && !pending.length)
      drains.splice(0).forEach((resolve) => resolve());
  };
  return {
    enqueue(input: unknown): Promise<Result> {
      if (closed) return Promise.reject(new Error("Queue is closed"));
      if (pending.length >= capacity)
        return Promise.reject(new Error("Queue capacity exceeded"));
      return new Promise((resolve, reject) => {
        pending.push({ input, resolve, reject });
        pump();
      });
    },
    metrics: () => ({ pending: pending.length, running, completed, failed }),
    async close() {
      closed = true;
      if (running || pending.length)
        await new Promise<void>((resolve) => drains.push(resolve));
    },
  };
}

/** Non-overlapping interval scheduler. Close it before closing the application. */
export function schedule(
  app: Application,
  op: Operation,
  options: {
    everyMs: number;
    input: () => unknown;
    onError?: (error: unknown) => void;
  },
) {
  if (!Number.isFinite(options.everyMs) || options.everyMs < 1)
    throw new Error("Invalid schedule interval");
  let active: Promise<unknown> | undefined;
  const timer = setInterval(() => {
    if (active) return;
    active = Promise.resolve()
      .then(() => app.execute(op.id, options.input()))
      .then(
        (result) => {
          if (!result.ok) options.onError?.(result);
        },
        (reason) => {
          options.onError?.(reason);
        },
      )
      .finally(() => {
        active = undefined;
      });
  }, options.everyMs);
  return {
    async close() {
      clearInterval(timer);
      await active;
    },
  };
}

/** A typed direct client: the same contract can be invoked without HTTP. */
export function client<M extends Record<string, Operation>>(
  app: Application,
  operations: M,
) {
  return Object.fromEntries(
    Object.entries(operations).map(([name, op]) => [
      name,
      (input: unknown) => app.execute(op.id, input),
    ]),
  ) as {
    [K in keyof M]: (
      input: Infer<M[K]["input"]>,
    ) => Promise<Result<Infer<M[K]["output"]>>>;
  };
}
