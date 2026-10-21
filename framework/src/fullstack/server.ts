import { Application, Fault, errorStatus } from "../core.js";
import type { BrowserEvent } from "../neutral/protocol.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function internalTransport(app: Application) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method !== "POST")
      return Response.json(
        { ok: false, kind: "fault", fault: { code: "METHOD_NOT_ALLOWED" } },
        { status: 405 },
      );
    if (
      request.headers.get("origin") &&
      request.headers.get("origin") !== url.origin
    )
      return Response.json(
        { ok: false, kind: "fault", fault: { code: "INVALID_ORIGIN" } },
        { status: 403 },
      );
    if (!request.headers.get("content-type")?.includes("application/json"))
      return Response.json(
        { ok: false, kind: "fault", fault: { code: "UNSUPPORTED_MEDIA_TYPE" } },
        { status: 415 },
      );
    if (url.pathname === "/_arc/telemetry") {
      try {
        const { events } = await request.json();
        if (!Array.isArray(events) || events.length > 100) throw Error();
        const ids = new Set(app.graph().partitions?.browser ?? []);
        for (const event of events) {
          if (
            !event ||
            !ids.has(event.node) ||
            typeof event.type !== "string" ||
            !event.type.match(
              /^(action|resource|remote|binding|view)\.[a-z]+$/,
            ) ||
            !Number.isFinite(event.time) ||
            (event.traceId !== undefined && !uuid.test(event.traceId)) ||
            (event.duration !== undefined &&
              (!Number.isFinite(event.duration) || event.duration < 0))
          )
            throw Error();
        }
        app.ingestBrowserEvents(
          events.map((e: BrowserEvent) => ({ ...e, source: "browser" })),
        );
        return Response.json({ ok: true });
      } catch {
        return Response.json(
          { ok: false, kind: "fault", fault: { code: "INVALID_TELEMETRY" } },
          { status: 400 },
        );
      }
    }
    const prefix = "/_arc/call/";
    if (!url.pathname.startsWith(prefix))
      return Response.json(
        { ok: false, kind: "fault", fault: { code: "NOT_FOUND" } },
        { status: 404 },
      );
    try {
      const id = decodeURIComponent(url.pathname.slice(prefix.length)),
        op = app.operations.find((op) => op.id === id);
      if (!op?.expose?.web)
        return Response.json(
          { ok: false, kind: "fault", fault: { code: "NOT_EXPOSED" } },
          { status: 403 },
        );
      let input;
      try {
        input = await request.json();
      } catch {
        throw new Fault("INVALID_JSON", 400);
      }
      const traceId = request.headers.get("x-arc-trace-id"),
        parentId = request.headers.get("x-arc-parent-span");
      const result = await app.execute(op.id, input, {
        request,
        signal: request.signal,
        ...(traceId && uuid.test(traceId) ? { traceId } : {}),
        ...(parentId && uuid.test(parentId) ? { parentSpanId: parentId } : {}),
      });
      return Response.json(
        result.ok ? result : { ...result, kind: "business_error" },
        {
          status: result.ok ? 200 : errorStatus(op.errors[result.error]),
          headers:
            traceId && uuid.test(traceId) ? { "x-arc-trace-id": traceId } : {},
        },
      );
    } catch (error) {
      const status = error instanceof Fault ? error.status : 500;
      return Response.json(
        {
          ok: false,
          kind: "fault",
          fault: {
            code:
              status < 500 && error instanceof Fault
                ? error.code
                : "INTERNAL_ERROR",
          },
        },
        { status },
      );
    }
  };
}
