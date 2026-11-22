import { userSchema, usersSchema, type Profile } from "./contracts.ts";

export class ProfileError extends Error {
  constructor(
    code: string,
    readonly fields: string[] = [],
  ) {
    super(code);
  }
}

async function readResponse(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new ProfileError(body.error, body.fields);
  return body;
}

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
