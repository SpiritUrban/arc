import { createServer, type Server } from "node:http";
import { Application, Fault, errorDetailsSchema, errorStatus } from "./core.js";
import { mapRoutePath } from "./neutral/route-path.js";
import { acceptsJsonBody } from "./neutral/http-method.js";

function httpInputValue(value: string, type: unknown): string | number | boolean {
  if ((type === "number" || type === "integer") && value.trim() !== "") return Number(value);
  if (type === "boolean" && (value === "true" || value === "false")) return value === "true";
  return value;
}

export function problem(e: unknown): Response {
  return Response.json(
    {
      ok: false,
      error: e instanceof Fault ? e.code : "INTERNAL_ERROR",
      ...(e instanceof Fault && e.details ? { details: e.details } : {}),
    },
    { status: e instanceof Fault ? e.status : 500 },
  );
}
export function handler(app: Application) {
  const routes = app.routes
    .map((route) => {
      const keys: string[] = [];
      const pattern = mapRoutePath(route.path, (name) => {
        keys.push(name);
        return "([^/]+)";
      }, (part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      return { ...route, keys, regex: new RegExp(`^${pattern}/?$`) };
    })
    .sort((a, b) => a.keys.length - b.keys.length);
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/openapi.json" && request.method === "GET")
        return Response.json(openapi(app));
      for (const route of routes) {
        if (request.method !== route.method) continue;
        const match = route.regex.exec(url.pathname);
        if (!match) continue;
        let body: Record<string, unknown> = {};
        if (acceptsJsonBody(request.method)) {
          if (
            !request.headers.get("content-type")?.includes("application/json")
          )
            throw new Fault("UNSUPPORTED_MEDIA_TYPE", 415);
          try {
            const value = await request.json();
            if (!value || typeof value !== "object" || Array.isArray(value))
              throw new Error();
            body = value;
          } catch {
            throw new Fault("INVALID_JSON", 400);
          }
        }
        const properties = route.operation.input.json.properties ?? {};
        const query = Object.fromEntries(
          Array.from(url.searchParams, ([name, value]) => [
            name, httpInputValue(value, properties[name]?.type),
          ]),
        );
        const params = Object.fromEntries(
          route.keys.map((k, i) => {
            try {
              return [k, httpInputValue(decodeURIComponent(match[i + 1]), properties[k]?.type)];
            } catch {
              throw new Fault("INVALID_PATH", 400);
            }
          }),
        );
        const result = await app.execute(
          route.operation.id,
          { ...body, ...query, ...params },
          { request, signal: request.signal },
        );
        return Response.json(result.ok ? result.value : result, {
          status: result.ok
            ? (route.status ?? 200)
            : errorStatus(route.operation.errors[result.error]),
        });
      }
      throw new Fault("NOT_FOUND", 404);
    } catch (e) {
      return problem(e);
    }
  };
}
function errorResponses(errors: import("./core.js").ErrorContracts) {
  const groups = new Map<number, { codes: string[]; schemas: any[] }>();
  for (const [code, def] of Object.entries(errors)) {
    const status = errorStatus(def),
      group = groups.get(status) ?? { codes: [], schemas: [] };
    const details = errorDetailsSchema(def);
    group.codes.push(code);
    group.schemas.push({
      type: "object",
      properties: {
        ok: { const: false },
        error: { const: code },
        ...(details ? { details: details.json } : {}),
      },
      required: [
        "ok",
        "error",
        ...(details ? ["details"] : []),
      ],
    });
    groups.set(status, group);
  }
  return Object.fromEntries(
    [...groups].map(([status, group]) => [
      status,
      {
        description: group.codes.join(" | "),
        content: {
          "application/json": {
            schema:
              group.schemas.length === 1
                ? group.schemas[0]
                : { oneOf: group.schemas },
          },
        },
      },
    ]),
  );
}
export function openapi(app: Application) {
  const paths: Record<string, any> = {};
  for (const r of app.routes) {
    const hasBody = acceptsJsonBody(r.method);
    const pathKeys = new Set<string>();
    const path = mapRoutePath(r.path, (name) => {
      pathKeys.add(name);
      return `{${name}}`;
    });
    const props = r.operation.input.json.properties ?? {};
    const parameters = Object.entries(props)
      .filter(
        ([k]) =>
          pathKeys.has(k) || !hasBody,
      )
      .map(([name, schema]) => ({
        name,
        in: pathKeys.has(name) ? "path" : "query",
        required:
          pathKeys.has(name) ||
          (r.operation.input.json.required ?? []).includes(name),
        schema,
      }));
    const bodyProps = Object.fromEntries(
      Object.entries(props).filter(([k]) => !pathKeys.has(k)),
    );
    (paths[path] ??= {})[r.method.toLowerCase()] = {
      operationId: r.operation.id,
      parameters,
      ...(hasBody
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    ...r.operation.input.json,
                    properties: bodyProps,
                    required: (r.operation.input.json.required ?? []).filter(
                      (k: string) => !pathKeys.has(k),
                    ),
                  },
                },
              },
            },
          }
        : {}),
      responses: {
        [r.status ?? 200]: {
          description: "Success",
          content: { "application/json": { schema: r.operation.output.json } },
        },
        ...errorResponses(r.operation.errors),
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "ARC application", version: "0.1.0" },
    paths,
  };
}
export async function serve(
  fetchHandler: (request: Request) => Promise<Response>,
  options: { port: number; host?: string; maxBodyBytes?: number },
): Promise<Server> {
  const server = createServer(async (req, res) => {
    try {
      const controller = new AbortController();
      req.on("aborted", () => controller.abort());
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > (options.maxBodyBytes ?? 1048576)) {
          res.writeHead(413, { "content-type": "application/json" });
          res.end('{"error":"BODY_TOO_LARGE"}');
          return;
        }
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (value)
          headers.set(key, Array.isArray(value) ? value.join(",") : value);
      const host = req.headers.host ?? "localhost";
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const request = new Request(`http://${host}${req.url}`, {
        method: req.method,
        headers,
        signal: controller.signal,
        ...(!["GET", "HEAD"].includes(req.method ?? "GET") && size
          ? { body: Buffer.concat(chunks) }
          : {}),
      });
      const response = await fetchHandler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) {
        res.end();
        return;
      }
      const reader = response.body.getReader();
      const disconnected = () => {
        controller.abort();
        void reader.cancel().catch(() => {});
      };
      res.once("close", disconnected);
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!res.write(value))
            await new Promise<void>((resolve) => {
              res.once("drain", resolve);
              res.once("close", resolve);
            });
        }
        res.end();
      } finally {
        res.off("close", disconnected);
        reader.releaseLock();
      }
    } catch (e) {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}
export async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
}
