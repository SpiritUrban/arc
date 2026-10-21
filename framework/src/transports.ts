import { Application, Fault, type Operation, type Result } from "./core.js";
import type { QueueDefinition, ScheduleDefinition } from "./core.js";
import {
  createQueueRuntime,
  createScheduleRuntime,
} from "./runtime-adapters.js";
import type { Infer } from "./schema.js";

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

/** Declarative transports are graph nodes. The legacy helper requires a registered declaration. */
export function queue(def: QueueOptions): QueueDefinition;
export function queue(
  app: Application,
  op: Operation,
  options?: { id?: string; concurrency?: number; capacity?: number },
): ReturnType<typeof createQueueRuntime>;
export function queue(
  first: Application | QueueOptions,
  op?: Operation,
  options: { id?: string; concurrency?: number; capacity?: number } = {},
) {
  if (!(first instanceof Application))
    return Object.freeze({ kind: "queue" as const, ...first });
  const id = options.id ?? `queue:${op!.id}`;
  const runtime = first.queues.get(id);
  return (
    runtime ??
    first.attachQueue({ kind: "queue", id, operation: op!, ...options })
  );
}
type QueueOptions = Omit<QueueDefinition, "kind">;
export function schedule(
  def: Omit<ScheduleDefinition, "kind">,
): ScheduleDefinition;
export function schedule(
  app: Application,
  op: Operation,
  options: {
    id?: string;
    everyMs: number;
    input: () => unknown;
    onError?: (error: unknown) => void;
  },
): ReturnType<typeof createScheduleRuntime>;
export function schedule(
  first: Application | Omit<ScheduleDefinition, "kind">,
  op?: Operation,
  options?: {
    id?: string;
    everyMs: number;
    input: () => unknown;
    onError?: (error: unknown) => void;
  },
): ScheduleDefinition | ReturnType<typeof createScheduleRuntime> {
  if (!(first instanceof Application))
    return Object.freeze({ kind: "schedule" as const, ...first });
  const id = options!.id ?? `schedule:${op!.id}`;
  return (
    first.scheduleRuntimes.get(id) ??
    first.attachSchedule({ kind: "schedule", id, operation: op!, ...options! })
  );
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
