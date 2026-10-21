import type { BrowserEvent } from "./protocol.js";
export class BrowserMetrics {
  private nodes = new Map<
    string,
    {
      calls: number;
      running: number;
      success: number;
      businessErrors: number;
      faults: number;
      cancelled: number;
      updates: number;
      lastUpdateMs: number;
      samples: { time: number; duration: number }[];
    }
  >();
  ingest(event: BrowserEvent) {
    const n = this.nodes.get(event.node) ?? {
      calls: 0,
      running: 0,
      success: 0,
      businessErrors: 0,
      faults: 0,
      cancelled: 0,
      updates: 0,
      lastUpdateMs: 0,
      samples: [],
    };
    if (event.type.endsWith(".started")) {
      n.calls++;
      n.running++;
    }
    if (event.type.endsWith(".finished")) {
      n.running = Math.max(0, n.running - 1);
      if (event.outcome === "ok") n.success++;
      else if (event.outcome === "business_error") n.businessErrors++;
      else if (event.outcome === "cancelled") n.cancelled++;
      else n.faults++;
      n.samples.push({ time: Date.now(), duration: event.duration ?? 0 });
    }
    if (event.type === "binding.updated") {
      n.updates++;
      n.lastUpdateMs = event.duration ?? 0;
    }
    this.nodes.set(event.node, n);
    const data = event.data;
    if (
      event.type === "binding.updated" &&
      data &&
      typeof data === "object" &&
      "view" in data &&
      typeof data.view === "string"
    )
      this.ingest({ ...event, node: data.view, data: undefined });
  }
  snapshot() {
    return [...this.nodes].map(([id, n]) => {
      n.samples = n.samples.filter((s) => s.time > Date.now() - 60000);
      const d = n.samples.map((s) => s.duration).sort((a, b) => a - b);
      return {
        id,
        ...n,
        samples: undefined,
        p50: d[Math.max(0, Math.ceil(d.length * 0.5) - 1)] ?? 0,
        p95: d[Math.max(0, Math.ceil(d.length * 0.95) - 1)] ?? 0,
      };
    });
  }
}
