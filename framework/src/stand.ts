import { Application, Fault } from "./core.ts";
import { handler, problem } from "./http.ts";
import { standHTML } from "./stand-ui.ts";
export function stand(app: Application) {
  const http = handler(app);
  const cases: {
    name: string;
    operation: string;
    input: unknown;
    expected: unknown;
  }[] = [];
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (request.method === "GET") {
        if (url.pathname === "/")
          return new Response(standHTML, {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "content-security-policy":
                "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
            },
          });
        if (url.pathname === "/api/graph") return Response.json(app.graph());
        if (url.pathname === "/api/live")
          return Response.json({
            metrics: app.metrics(),
            traces: app.traces,
            faults: Object.fromEntries(app.faults),
            tests: cases,
          });
      }
      if (request.method !== "POST") throw new Fault("NOT_FOUND", 404);
      // A local developer tool: reject cross-origin browser writes.
      if (
        request.headers.get("origin") &&
        request.headers.get("origin") !== url.origin
      )
        throw new Fault("INVALID_ORIGIN", 403);
      if (!request.headers.get("content-type")?.includes("application/json"))
        throw new Fault("UNSUPPORTED_MEDIA_TYPE", 415);
      let body: any;
      try {
        body = await request.json();
      } catch {
        throw new Fault("INVALID_JSON", 400);
      }
      const op = app.operations.find((o) => o.id === body.operation);
      const run = async () => {
        if (!op) throw new Fault("OPERATION_NOT_FOUND", 404);
        if (body.mode === "http") {
          const route = app.routes.find((r) => r.operation === op);
          if (!route) throw new Fault("ROUTE_NOT_FOUND", 404);
          const input = { ...body.input };
          const path = route.path.replace(/:([^/]+)/g, (_, key) => {
            const value = input[key];
            delete input[key];
            return encodeURIComponent(value);
          });
          const target = new URL(path, "http://localhost");
          if (["GET", "DELETE", "HEAD"].includes(route.method))
            for (const [k, v] of Object.entries(input))
              target.searchParams.set(k, String(v));
          const response = await http(
            new Request(target, {
              method: route.method,
              headers: {
                "content-type": "application/json",
                ...(body.authorization
                  ? { authorization: body.authorization }
                  : {}),
              },
              ...(!["GET", "DELETE", "HEAD"].includes(route.method)
                ? { body: JSON.stringify(input) }
                : {}),
            }),
          );
          return { status: response.status, body: await response.json() };
        }
        return app.execute(op.id, body.input, {
          request: new Request("http://localhost", {
            headers: body.authorization
              ? { authorization: body.authorization }
              : {},
          }),
        });
      };
      if (url.pathname === "/api/run") return Response.json(await run());
      if (url.pathname === "/api/test/save") {
        if (!op) throw new Fault("OPERATION_NOT_FOUND", 404);
        cases.push({
          name: String(body.name ?? op.id).slice(0, 100),
          operation: op.id,
          input: body.input,
          expected: body.expected,
        });
        return Response.json({ saved: true });
      }
      if (url.pathname === "/api/test/run") {
        const results = [];
        for (const t of cases) {
          try {
            const actual = await app.execute(t.operation, t.input);
            results.push({
              name: t.name,
              passed: JSON.stringify(actual) === JSON.stringify(t.expected),
              actual,
            });
          } catch (e) {
            results.push({
              name: t.name,
              passed: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        return Response.json(results);
      }
      if (url.pathname === "/api/fault") {
        if (!app.graph().nodes.some((n) => n.id === body.node))
          throw new Fault("NODE_NOT_FOUND", 404);
        if (body.clear) app.faults.delete(body.node);
        else {
          const latencyMs = Number(body.latencyMs ?? 0),
            errorRate = Number(body.errorRate ?? 0);
          if (
            !Number.isFinite(latencyMs) ||
            latencyMs < 0 ||
            latencyMs > 5000 ||
            !Number.isFinite(errorRate) ||
            errorRate < 0 ||
            errorRate > 1
          )
            throw new Fault("INVALID_FAULT", 400);
          app.faults.set(body.node, { latencyMs, errorRate });
        }
        return Response.json({ ok: true });
      }
      if (url.pathname === "/api/load") {
        const count = Number(body.count ?? 100),
          concurrency = Number(body.concurrency ?? 5);
        if (
          !Number.isInteger(count) ||
          count < 1 ||
          count > 1000 ||
          !Number.isInteger(concurrency) ||
          concurrency < 1 ||
          concurrency > 25
        )
          throw new Fault("INVALID_LOAD", 400);
        let next = 0,
          errors = 0;
        const durations: number[] = [];
        const start = performance.now();
        await Promise.all(
          Array.from({ length: concurrency }, async () => {
            while (next++ < count) {
              if (request.signal.aborted) break;
              const begin = performance.now();
              try {
                const result: any = await run();
                if (result.ok === false || result.status >= 400) errors++;
              } catch {
                errors++;
              }
              durations.push(performance.now() - begin);
            }
          }),
        );
        durations.sort((a, b) => a - b);
        const durationMs = performance.now() - start;
        return Response.json({
          completed: durations.length,
          errors,
          durationMs,
          rps: durations.length / (durationMs / 1000),
          p50: durations[Math.floor(durations.length * 0.5)],
          p95: durations[
            Math.min(durations.length - 1, Math.floor(durations.length * 0.95))
          ],
          note: "In-process load; shared event loop, not an external capacity benchmark.",
        });
      }
      throw new Fault("NOT_FOUND", 404);
    } catch (e) {
      return problem(e);
    }
  };
}
