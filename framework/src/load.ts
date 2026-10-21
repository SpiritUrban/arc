import { setTimeout as delay } from "node:timers/promises";
export interface LoadOptions {
  count?: number;
  durationMs?: number;
  concurrency?: number;
  targetRps?: number;
  rampUpMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface LoadOutcome {
  kind: "ok" | "business_error" | "fault" | "cancelled";
  status?: number;
}
export async function runLoad(
  run: (index: number, signal: AbortSignal) => Promise<LoadOutcome>,
  options: LoadOptions = {},
) {
  const count = options.count ?? (options.durationMs ? 100000 : 100),
    concurrency = options.concurrency ?? 5,
    duration = options.durationMs ?? Infinity,
    rps = options.targetRps ?? Infinity,
    ramp = options.rampUpMs ?? 0;
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 100000 ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 100 ||
    duration <= 0 ||
    Number.isNaN(duration) ||
    rps <= 0 ||
    Number.isNaN(rps) ||
    ramp < 0 ||
    !Number.isFinite(ramp) ||
    (options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0))
  )
    throw new Error("Invalid load options");
  let issued = 0,
    active = 0,
    peak = 0;
  const durations: number[] = [];
  const outcomes = { ok: 0, business_error: 0, fault: 0, cancelled: 0 };
  const start = performance.now();
  const scheduled = (index: number) => {
    if (!Number.isFinite(rps)) return 0;
    const seconds = ramp / 1000,
      half = (rps * seconds) / 2;
    return index < half
      ? Math.sqrt((2 * index * seconds) / rps) * 1000
      : (seconds + (index - half) / rps) * 1000;
  };
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = issued++;
        if (index >= count || options.signal?.aborted) break;
        const at = scheduled(index);
        if (at >= duration || performance.now() - start >= duration) break;
        const wait = at - (performance.now() - start);
        if (wait > 0)
          try {
            await delay(wait, undefined, { signal: options.signal });
          } catch {
            break;
          }
        if (options.signal?.aborted || performance.now() - start >= duration)
          break;
        const controller = new AbortController();
        const onAbort = () => controller.abort(options.signal?.reason);
        options.signal?.addEventListener("abort", onAbort, { once: true });
        const timeout = options.timeoutMs
          ? setTimeout(
              () => controller.abort(new Error("Load timeout")),
              options.timeoutMs,
            )
          : undefined;
        const begin = performance.now();
        active++;
        peak = Math.max(peak, active);
        try {
          const result = await run(index, controller.signal);
          outcomes[controller.signal.aborted ? "cancelled" : result.kind]++;
        } catch {
          outcomes[controller.signal.aborted ? "cancelled" : "fault"]++;
        } finally {
          active--;
          if (timeout) clearTimeout(timeout);
          options.signal?.removeEventListener("abort", onAbort);
          durations.push(performance.now() - begin);
        }
      }
    }),
  );
  durations.sort((a, b) => a - b);
  const p = (q: number) =>
    durations[Math.max(0, Math.ceil(durations.length * q) - 1)] ?? 0;
  const durationMs = performance.now() - start;
  const errors = outcomes.business_error + outcomes.fault + outcomes.cancelled;
  return {
    completed: durations.length,
    errors,
    ...outcomes,
    durationMs,
    rps: durations.length / (durationMs / 1000),
    p50: p(0.5),
    p95: p(0.95),
    p99: p(0.99),
    peakConcurrent: peak,
    targetRps: Number.isFinite(rps) ? rps : null,
    saturated:
      Number.isFinite(rps) &&
      durations.length > 0 &&
      durations.length / (durationMs / 1000) < rps * 0.8 &&
      peak === concurrency,
  };
}
export interface BreakingConstraints {
  maxErrorRate?: number;
  maxFaultRate?: number;
  p95Ms?: number;
  maxCancelledRate?: number;
  failOnSaturation?: boolean;
}
export async function findBreakingPoint(
  run: (index: number, signal: AbortSignal) => Promise<LoadOutcome>,
  options: LoadOptions & {
    initialRps?: number;
    maxRps?: number;
    steps?: number;
    constraints?: BreakingConstraints;
  } = {},
) {
  const constraints = options.constraints ?? {},
    rounds = [];
  for (const key of [
    "maxErrorRate",
    "maxFaultRate",
    "maxCancelledRate",
  ] as const) {
    const value = constraints[key];
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value < 0 || value > 1)
    )
      throw new Error("Invalid breaking point constraints");
  }
  if (
    constraints.p95Ms !== undefined &&
    (!Number.isFinite(constraints.p95Ms) || constraints.p95Ms < 0)
  )
    throw new Error("Invalid p95 budget");
  let rps = options.initialRps ?? 10,
    lastPassingRps: number | null = null,
    firstFailingRps: number | null = null;
  if (
    !Number.isFinite(rps) ||
    rps <= 0 ||
    !Number.isFinite(options.maxRps ?? 1000) ||
    (options.maxRps ?? 1000) < rps ||
    !Number.isInteger(options.steps ?? 6) ||
    (options.steps ?? 6) < 1 ||
    (options.steps ?? 6) > 12
  )
    throw new Error("Invalid breaking point options");
  for (let i = 0; i < (options.steps ?? 6); i++) {
    const result = await runLoad(run, {
      ...options,
      durationMs: options.durationMs ?? 1000,
      count: options.count ?? 100000,
      targetRps: rps,
    });
    const n = Math.max(1, result.completed);
    const failures = [];
    if (result.errors / n > (constraints.maxErrorRate ?? 0.01))
      failures.push("error_rate");
    if (result.fault / n > (constraints.maxFaultRate ?? 0.01))
      failures.push("fault_rate");
    if (result.p95 > (constraints.p95Ms ?? 1000)) failures.push("p95");
    if (result.cancelled / n > (constraints.maxCancelledRate ?? 0))
      failures.push("timeouts/cancelled");
    if (constraints.failOnSaturation !== false && result.saturated)
      failures.push("saturation");
    if (!result.completed) failures.push("no_samples");
    rounds.push({ targetRps: rps, passed: !failures.length, failures, result });
    if (options.signal?.aborted) break;
    if (failures.length) firstFailingRps = rps;
    else lastPassingRps = rps;
    if (firstFailingRps !== null && lastPassingRps !== null)
      rps = (firstFailingRps + lastPassingRps) / 2;
    else if (firstFailingRps !== null) rps /= 2;
    else rps = Math.min(rps * 2, options.maxRps ?? 1000);
  }
  return {
    lastPassingRps,
    firstFailingRps,
    rounds,
    constraints,
    note: "Observed bracket for this benchmark mode, input and run; not deployment capacity.",
  };
}
