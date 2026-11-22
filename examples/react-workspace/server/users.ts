import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  demoUserId,
  profileSchema,
  type User,
} from "../src/users/contracts.ts";

import { readJson, sendJson } from "./json.ts";

const users = new Map<string, User>([
  [
    demoUserId,
    { id: demoUserId, name: "Demo User", email: "demo@example.com" },
  ],
]);

export function findUser(id: string) {
  return users.get(id);
}

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
      const user = findUser(id);
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

  const profile = await readJson(request, response, profileSchema);
  if (!profile) return true;
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
  sendJson(response, creating ? 201 : 200, user);
  return true;
}
