const monotonic = () =>
  (globalThis as { performance?: { now(): number } }).performance?.now() ??
  Date.now();
export type Outcome = "ok" | "business_error" | "fault" | "cancelled";
interface Meter {
  total: number;
  active: number;
  peak: number;
  outcomes: Record<Outcome, number>;
  recent: { time: number; duration: number; outcome: Outcome }[];
}
/** Independent of trace retention. Exact samples retained only for the configured time window. */
export class MetricsAccumulator {
  private meters = new Map<string, Meter>();
  constructor(
    readonly windowMs = 60000,
    private now = () => Date.now(),
  ) {
    if (!Number.isFinite(windowMs) || windowMs <= 0)
      throw new Error("Invalid metrics window");
  }
  private meter(id: string) {
    let meter = this.meters.get(id);
    if (!meter) {
      meter = {
        total: 0,
        active: 0,
        peak: 0,
        outcomes: { ok: 0, business_error: 0, fault: 0, cancelled: 0 },
        recent: [],
      };
      this.meters.set(id, meter);
    }
    return meter;
  }
  begin(id: string) {
    const meter = this.meter(id);
    meter.total++;
    meter.active++;
    meter.peak = Math.max(meter.peak, meter.active);
    return { id, started: monotonic() };
  }
  end(token: { id: string; started: number }, outcome: Outcome) {
    const meter = this.meter(token.id);
    meter.active--;
    meter.outcomes[outcome]++;
    meter.recent.push({
      time: this.now(),
      duration: monotonic() - token.started,
      outcome,
    });
    this.prune(meter);
  }
  private prune(meter: Meter) {
    const cutoff = this.now() - Math.max(60000, this.windowMs);
    while (meter.recent.length && meter.recent[0].time < cutoff)
      meter.recent.shift();
  }
  snapshot(ids = [...this.meters.keys()]) {
    return ids.map((id) => {
      const m = this.meter(id);
      this.prune(m);
      const d = m.recent
        .filter((v) => v.time >= this.now() - this.windowMs)
        .map((v) => v.duration)
        .sort((a, b) => a - b);
      const p = (q: number) => d[Math.max(0, Math.ceil(d.length * q) - 1)] ?? 0;
      const rpm = m.recent.filter((v) => v.time >= this.now() - 60000).length;
      return {
        id,
        totalCalls: m.total,
        count: m.total,
        active: m.active,
        peakConcurrent: m.peak,
        ...m.outcomes,
        errors:
          m.outcomes.business_error + m.outcomes.fault + m.outcomes.cancelled,
        rpm,
        rps: m.recent.filter((v) => v.time >= this.now() - 1000).length,
        p50: p(0.5),
        p95: p(0.95),
        p99: p(0.99),
        windowMs: this.windowMs,
      };
    });
  }
}
