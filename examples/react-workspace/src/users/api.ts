import { readResponse } from "../http.ts";
import { userSchema, usersSchema, type Profile } from "./contracts.ts";

export async function listUsers(signal: AbortSignal) {
  return usersSchema.parse(
    await readResponse(await fetch("/api/users", { signal })),
  );
}

export async function saveUser(profile: Profile, id?: string) {
  const response = await fetch(id ? `/api/users/${id}` : "/api/users", {
    method: id ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(profile),
  });
  return userSchema.parse(await readResponse(response));
}
