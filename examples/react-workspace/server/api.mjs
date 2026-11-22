import { createServer } from "node:http";
import { handleOrders } from "./orders.ts";
import { handleUsers } from "./users.ts";

export async function handleApi(request, response, path) {
  if (path !== "/api" && !path.startsWith("/api/")) return false;
  response.setHeader("content-type", "application/json; charset=utf-8");
  if (path === "/api/health" && request.method === "GET") {
    response.end(JSON.stringify({ ok: true }));
  } else if (
    !(await handleUsers(request, response, path)) &&
    !(await handleOrders(request, response, path))
  ) {
    response.writeHead(404).end(JSON.stringify({ error: "NOT_FOUND" }));
  }
  return true;
}

export function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

export function apiServer() {
  return createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (!(await handleApi(request, response, path)))
      response.writeHead(404).end();
  });
}
