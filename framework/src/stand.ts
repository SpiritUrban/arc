import { Application, Fault } from "./core.js";
import { handler, problem } from "./http.js";
import { standHTML } from "./stand-ui.js";
import { generateCases } from "./generator.js";
import { runLoad, findBreakingPoint, type LoadOutcome } from "./load.js";
import { runTestSpec, type StandTestSpec } from "./test-spec.js";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
export interface StandOptions {
  testFile?: string;
  hooks?: Record<string, () => void | Promise<void>>;
  networkBaseUrl?: string;
}
export function stand(app: Application, options: StandOptions = {}) {
  const http = handler(app);
  const cases: StandTestSpec[] = [];
  const loaded = options.testFile
    ? readFile(options.testFile, "utf8")
        .then((text) => {
          const parsed = JSON.parse(text);
          if (!Array.isArray(parsed))
            throw new Error("Invalid Stand test file");
          cases.push(...parsed.map(validateSpec));
        })
        .catch((e) => {
          if (e.code !== "ENOENT") throw e;
        })
    : Promise.resolve();
  function validateSpec(spec: any): StandTestSpec {
    if (
      !spec ||
      spec.version !== 1 ||
      typeof spec.operation !== "string" ||
      typeof spec.name !== "string" ||
      !Object.hasOwn(spec, "expected") ||
      !app.operations.some((op) => op.id === spec.operation)
    )
      throw new Fault("INVALID_TEST_SPEC", 400);
    return spec;
  }
  const redacted = (spec: StandTestSpec, context: boolean) =>
    context ? spec : { ...spec, request: undefined };
  let saving = Promise.resolve();
  const save = () => {
    if (!options.testFile) throw new Fault("TEST_FILE_NOT_CONFIGURED", 400);
    const file = options.testFile,
      text = JSON.stringify(cases, null, 2);
    saving = saving
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file + ".tmp", text + "\n", { mode: 0o600 });
        await rename(file + ".tmp", file);
      });
    return saving;
  };
  return async (request: Request): Promise<Response> => {
    try {
      await loaded;
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
            browserMetrics: app.browserMetrics.snapshot(),
            browserEvents: app.browserEvents,
            interactions: [
              ...new Set(
                [
                  ...app.browserEvents.map((e) => e.traceId),
                  ...app.traces.map((t) => t.id),
                ].filter(Boolean),
              ),
            ].map((traceId) => ({
              traceId,
              browser: app.browserEvents.filter((e) => e.traceId === traceId),
              server: app.traces.filter((t) => t.id === traceId),
              timingNote:
                "Browser clock timestamps and server durations are not clock-synchronized; remote span includes network + server, not isolated network latency.",
            })),
            metrics: app.metrics(),
            traces: app.traces,
            faults: Object.fromEntries(app.faults),
            tests: cases.map((c) => redacted(c, false)),
            queues: Object.fromEntries(
              [...app.queues].map(([id, q]) => [id, q.metrics()]),
            ),
          });
        if (url.pathname === "/api/test/export")
          return Response.json(
            cases.map((c) =>
              redacted(c, url.searchParams.get("includeContext") === "1"),
            ),
            {
              headers: {
                "content-disposition": 'attachment; filename="arc-tests.json"',
              },
            },
          );
        if (url.pathname === "/api/events") {
          let unsubscribe = () => {};
          let stop = () => {};
          const encoder = new TextEncoder();
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              let ended = false;
              stop = () => {
                if (ended) return;
                ended = true;
                unsubscribe();
                request.signal.removeEventListener("abort", stop);
                try {
                  controller.close();
                } catch {}
              };
              controller.enqueue(
                encoder.encode('data: {"type":"connected"}\n\n'),
              );
              unsubscribe = app.subscribe((event) => {
                if (event.type === "application.stopping") {
                  stop();
                  return;
                }
                if ((controller.desiredSize ?? 0) < -32) {
                  stop();
                  return;
                }
                try {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
                  );
                } catch {
                  stop();
                }
              });
              request.signal.addEventListener("abort", stop, { once: true });
              if (request.signal.aborted) stop();
            },
            cancel() {
              stop();
            },
          });
          return new Response(stream, {
            headers: {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
              connection: "keep-alive",
            },
          });
        }
      }
      if (request.method !== "POST") throw new Fault("NOT_FOUND", 404);
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
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw Error();
      } catch {
        throw new Fault("INVALID_JSON", 400);
      }
      const op = app.operations.find((o) => o.id === body.operation);
      const run = async (input = body.input, signal = request.signal) => {
        if (!op) throw new Fault("OPERATION_NOT_FOUND", 404);
        if (body.mode === "http" || body.mode === "network") {
          const route = app.routes.find((r) => r.operation === op);
          if (!route) throw new Fault("ROUTE_NOT_FOUND", 404);
          const values = { ...input };
          const path = route.path.replace(/:([^/]+)/g, (_, key) => {
            const value = values[key];
            delete values[key];
            return encodeURIComponent(value);
          });
          const target = new URL(
            path,
            body.mode === "network"
              ? (options.networkBaseUrl ?? "http://localhost")
              : "http://localhost",
          );
          if (body.mode === "network" && !options.networkBaseUrl)
            throw new Fault("NETWORK_BASE_NOT_CONFIGURED", 400);
          if (["GET", "DELETE", "HEAD"].includes(route.method))
            for (const [k, v] of Object.entries(values))
              target.searchParams.set(k, String(v));
          const req = new Request(target, {
            method: route.method,
            signal,
            headers: {
              "content-type": "application/json",
              ...(body.authorization
                ? { authorization: body.authorization }
                : {}),
            },
            ...(!["GET", "DELETE", "HEAD"].includes(route.method)
              ? { body: JSON.stringify(values) }
              : {}),
          });
          const response =
            body.mode === "network" ? await fetch(req) : await http(req);
          return { status: response.status, body: await response.json() };
        }
        return app.execute(op.id, input, {
          signal,
          request: new Request("http://localhost", {
            signal,
            headers: body.authorization
              ? { authorization: body.authorization }
              : {},
          }),
        });
      };
      if (url.pathname === "/api/generate") {
        if (!op) throw new Fault("OPERATION_NOT_FOUND", 404);
        return Response.json(generateCases(op.input));
      }
      if (url.pathname === "/api/run") return Response.json(await run());
      if (url.pathname === "/api/test/import") {
        if (!Array.isArray(body.tests) || body.tests.length > 1000)
          throw new Fault("INVALID_TEST_SPEC", 400);
        cases.push(...body.tests.map(validateSpec));
        if (body.persist) await save();
        return Response.json({ imported: body.tests.length });
      }
      if (url.pathname === "/api/test/save") {
        if (!op) throw new Fault("OPERATION_NOT_FOUND", 404);
        cases.push(
          validateSpec({
            version: 1,
            name: String(body.name ?? op.id).slice(0, 100),
            operation: op.id,
            input: body.input,
            expected: body.expected,
            ...(body.includeContext
              ? {
                  request: {
                    authorization: body.authorization,
                    headers: body.headers,
                  },
                }
              : {}),
            setup: body.setup,
            reset: body.reset,
          }),
        );
        if (body.persist) await save();
        return Response.json({ saved: true, persisted: !!body.persist });
      }
      if (url.pathname === "/api/test/persist") {
        await save();
        return Response.json({ saved: cases.length });
      }
      if (url.pathname === "/api/test/run") {
        const results = [];
        for (const test of cases)
          try {
            results.push(await runTestSpec(app, test, options.hooks));
          } catch (e) {
            results.push({ name: test.name, passed: false, error: String(e) });
          }
        return Response.json(results);
      }
      if (url.pathname === "/api/fault") {
        const node = app.graph().nodes.find((n) => n.id === body.node);
        if (!node || !["operation", "resource", "effect"].includes(node.kind))
          throw new Fault("NODE_NOT_INSTRUMENTABLE", 400);
        if (node.kind === "resource" && node.scope === "application")
          throw new Fault("SELECT_EXPLICIT_EFFECT_METHOD", 400);
        if (body.clear) app.faults.delete(body.node);
        else {
          const latencyMs = Number(body.latencyMs ?? 0),
            errorRate = Number(body.errorRate ?? 0),
            timeoutMs = Number(body.timeoutMs ?? 0);
          if (
            !Number.isFinite(latencyMs) ||
            latencyMs < 0 ||
            latencyMs > 5000 ||
            !Number.isFinite(errorRate) ||
            errorRate < 0 ||
            errorRate > 1 ||
            !Number.isFinite(timeoutMs) ||
            timeoutMs < 0 ||
            timeoutMs > 5000
          )
            throw new Fault("INVALID_FAULT", 400);
          app.faults.set(body.node, {
            latencyMs,
            errorRate,
            timeoutMs,
            unavailable: !!body.unavailable,
          });
        }
        return Response.json({ ok: true });
      }
      if (url.pathname === "/api/load" || url.pathname === "/api/breaking") {
        if (!op) throw new Fault("OPERATION_NOT_FOUND", 404);
        const corpus =
          body.inputMode === "generated"
            ? generateCases(op.input).filter((c) => c.valid)
            : [];
        const runner = async (
          index: number,
          signal: AbortSignal,
        ): Promise<LoadOutcome> => {
          const result: any = await run(
            corpus.length ? corpus[index % corpus.length].value : body.input,
            signal,
          );
          return {
            kind:
              result.ok === false
                ? "business_error"
                : result.status >= 500
                  ? "fault"
                  : result.status >= 400
                    ? "business_error"
                    : "ok",
          };
        };
        const count = body.count === undefined ? undefined : Number(body.count),
          durationMs =
            body.durationMs === undefined ? undefined : Number(body.durationMs);
        if (
          (count !== undefined && count > 10000) ||
          (durationMs !== undefined && durationMs > 30000)
        )
          throw new Fault("LOAD_LIMIT_EXCEEDED", 400);
        const settings = {
          count,
          durationMs,
          concurrency: Number(body.concurrency ?? 5),
          targetRps:
            body.targetRps === undefined ? undefined : Number(body.targetRps),
          rampUpMs: Number(body.rampUpMs ?? 0),
          timeoutMs:
            body.timeoutMs === undefined ? undefined : Number(body.timeoutMs),
          signal: request.signal,
        };
        const result =
          url.pathname === "/api/breaking"
            ? await findBreakingPoint(runner, {
                ...settings,
                initialRps: body.initialRps,
                maxRps: body.maxRps,
                steps: body.steps,
                constraints: body.constraints,
              })
            : await runLoad(runner, settings);
        return Response.json({
          ...result,
          mode: body.mode ?? "operation",
          note:
            body.mode === "network"
              ? "Real local network round trips; client and server may share host/process."
              : "In-process executor or local HTTP-handler benchmark; not deployment throughput.",
        });
      }
      throw new Fault("NOT_FOUND", 404);
    } catch (e) {
      return problem(e);
    }
  };
}
