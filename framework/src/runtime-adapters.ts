import type {
  Application,
  QueueDefinition,
  ScheduleDefinition,
  Result,
} from "./core.js";
export function createQueueRuntime(
  app: Application,
  definition: QueueDefinition,
  execute = (input: unknown) => app.execute(definition.operation.id, input),
) {
  const concurrency = definition.concurrency ?? 4,
    capacity = definition.capacity ?? 1000;
  const pending: {
    input: unknown;
    resolve: (result: Result) => void;
    reject: (error: unknown) => void;
  }[] = [];
  let running = 0,
    completed = 0,
    failed = 0,
    closed = false;
  const drains: (() => void)[] = [];
  const metrics = () => ({
    pending: pending.length,
    running,
    completed,
    failed,
  });
  const state = () => {
    app.publish("queue.state", definition.id, metrics());
    app.publish("worker.state", `worker:${definition.id}`, {
      running,
      concurrency,
    });
  };
  const pump = () => {
    while (running < concurrency && pending.length) {
      const job = pending.shift()!;
      running++;
      state();
      void execute(job.input)
        .then(
          (result) => {
            completed++;
            if (!result.ok) failed++;
            job.resolve(result);
          },
          (reason) => {
            failed++;
            job.reject(reason);
          },
        )
        .finally(() => {
          running--;
          state();
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
        state();
        pump();
      });
    },
    metrics,
    async close() {
      closed = true;
      if (running || pending.length)
        await new Promise<void>((resolve) => drains.push(resolve));
    },
  };
}
export function createScheduleRuntime(
  app: Application,
  def: ScheduleDefinition,
) {
  let active: Promise<unknown> | undefined;
  const timer = setInterval(() => {
    if (active) return;
    app.publish("schedule.triggered", def.id);
    active = Promise.resolve()
      .then(() => app.execute(def.operation.id, def.input()))
      .then(
        (result) => {
          if (!result.ok) def.onError?.(result);
        },
        (reason) => def.onError?.(reason),
      )
      .catch((reason) => {
        app.publish("schedule.error", def.id, { message: String(reason) });
      })
      .finally(() => {
        active = undefined;
      });
  }, def.everyMs);
  return {
    async close() {
      clearInterval(timer);
      await active;
    },
  };
}
