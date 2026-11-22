import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname } from "node:path";
import { matchPath } from "react-router";
import { paths } from "../src/paths.ts";
import { handleApi, listen } from "./api.mjs";

const dist = new URL("../dist/", import.meta.url);
const index = await readFile(new URL("index.html", dist));
const contentTypes = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (handleApi(request, response, path)) return;
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" }).end();
    return;
  }
  if (/^\/assets\/[a-zA-Z0-9._-]+$/.test(path)) {
    try {
      const content = await readFile(new URL(path.slice(1), dist));
      response.writeHead(200, {
        "content-type": contentTypes[extname(path)] ?? "application/octet-stream",
      }).end(content);
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end();
    }
    return;
  }
  const found = Object.values(paths).some((pattern) => matchPath(pattern, path));
  response.writeHead(found ? 200 : 404, {
    "content-type": "text/html; charset=utf-8",
  }).end(index);
});

const port = await listen(server, Number(process.env.PORT ?? 4325));
console.log(`React Workspace http://127.0.0.1:${port}`);
