import { createServer, type Server } from "node:http";
import { Application, Fault } from "./core.ts";
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
      const pattern = route.path
        .split("/")
        .map((part) =>
          part.startsWith(":")
            ? (keys.push(part.slice(1)), "([^/]+)")
            : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        )
        .join("/");
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
        if (!["GET", "HEAD", "DELETE"].includes(request.method)) {
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
        const query = Object.fromEntries(url.searchParams);
        const properties = route.operation.input.json.properties ?? {};
        for (const [k, v] of Object.entries(query)) {
          if (["number", "integer"].includes(properties[k]?.type))
            (query as any)[k] = v.trim() === "" ? v : Number(v);
          else if (
            properties[k]?.type === "boolean" &&
            ["true", "false"].includes(v)
          )
            (query as any)[k] = v === "true";
        }
        const params = Object.fromEntries(
          route.keys.map((k, i) => {
            try {
              return [k, decodeURIComponent(match[i + 1])];
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
            : route.operation.errors[result.error],
        });
      }
      throw new Fault("NOT_FOUND", 404);
    } catch (e) {
      return problem(e);
    }
  };
}
export function openapi(app: Application) {
  const paths: Record<string, any> = {};
  for (const r of app.routes) {
    const path = r.path.replace(/:([^/]+)/g, "{$1}");
    const pathKeys = [...r.path.matchAll(/:([^/]+)/g)].map((m) => m[1]);
    const props = r.operation.input.json.properties ?? {};
    const parameters = Object.entries(props)
      .filter(
        ([k]) =>
          pathKeys.includes(k) || ["GET", "DELETE", "HEAD"].includes(r.method),
      )
      .map(([name, schema]) => ({
        name,
        in: pathKeys.includes(name) ? "path" : "query",
        required:
          pathKeys.includes(name) ||
          (r.operation.input.json.required ?? []).includes(name),
        schema,
      }));
    const bodyProps = Object.fromEntries(
      Object.entries(props).filter(([k]) => !pathKeys.includes(k)),
    );
    (paths[path] ??= {})[r.method.toLowerCase()] = {
      operationId: r.operation.id,
      parameters,
      ...(!["GET", "DELETE", "HEAD"].includes(r.method)
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    ...r.operation.input.json,
                    properties: bodyProps,
                    required: (r.operation.input.json.required ?? []).filter(
                      (k: string) => !pathKeys.includes(k),
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
        ...Object.fromEntries(
          Object.entries(r.operation.errors).map(([code, status]) => [
            status,
            { description: code },
          ]),
        ),
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
      res.end(Buffer.from(await response.arrayBuffer()));
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
