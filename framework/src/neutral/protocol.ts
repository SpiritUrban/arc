export interface TraceToken {
  traceId: string;
  parentId?: string;
}
export interface BrowserEvent {
  source: "browser";
  type: string;
  node: string;
  traceId?: string;
  spanId?: string;
  parentId?: string;
  time: number;
  duration?: number;
  outcome?: "ok" | "business_error" | "fault" | "cancelled";
  data?: unknown;
}
export const identity = () =>
  (
    globalThis as unknown as { crypto: { randomUUID(): string } }
  ).crypto.randomUUID();
export interface WebTelemetry {
  emit(event: BrowserEvent): void;
}
export const silentTelemetry: WebTelemetry = { emit() {} };
export function browserEvent(
  telemetry: WebTelemetry,
  node: string,
  type: string,
  trace?: TraceToken,
  extra: Partial<BrowserEvent> = {},
) {
  telemetry.emit({
    source: "browser",
    type,
    node,
    time: Date.now(),
    ...trace,
    ...extra,
  });
}
