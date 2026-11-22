import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  demoUserId,
  profileSchema,
  type User,
} from "../src/users/contracts.ts";

const users = new Map<string, User>([
  [
    demoUserId,
    { id: demoUserId, name: "Demo User", email: "demo@example.com" },
  ],
]);

export async function handleUsers(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
) {
  const member = /^\/api\/users\/([^/]+)$/.exec(path);
  if (path !== "/api/users" && !member) return false;

  const id = member?.[1];
  if (request.method === "GET") {
    if (!id) {
      response.end(JSON.stringify([...users.values()]));
    } else {
      const user = users.get(id);
      if (user) response.end(JSON.stringify(user));
      else
        response
          .writeHead(404)
          .end(JSON.stringify({ error: "USER_NOT_FOUND" }));
    }
    return true;
  }

  const creating = request.method === "POST" && !id;
  const editing = request.method === "PUT" && !!id;
  if (!creating && !editing) return false;

  if (!request.headers["content-type"]?.includes("application/json")) {
    response
      .writeHead(415)
      .end(JSON.stringify({ error: "UNSUPPORTED_MEDIA_TYPE" }));
    return true;
  }
  let body: unknown;
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    response.writeHead(400).end(JSON.stringify({ error: "INVALID_JSON" }));
    return true;
  }
  const profile = profileSchema.safeParse(body);
  if (!profile.success) {
    const fields = [
      ...new Set(
        profile.error.issues.map(({ path }) => path[0]).filter(Boolean),
      ),
    ];
    response
      .writeHead(400)
      .end(JSON.stringify({ error: "VALIDATION_ERROR", fields }));
    return true;
  }
  if (id && !users.has(id)) {
    response.writeHead(404).end(JSON.stringify({ error: "USER_NOT_FOUND" }));
    return true;
  }
  if (
    [...users.values()].some(
      (user) => user.email === profile.data.email && user.id !== id,
    )
  ) {
    response.writeHead(409).end(JSON.stringify({ error: "EMAIL_EXISTS" }));
    return true;
  }
  const user = { id: id ?? randomUUID(), ...profile.data };
  users.set(user.id, user);
  response.writeHead(creating ? 201 : 200).end(JSON.stringify(user));
  return true;
}
