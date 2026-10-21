import { randomUUID } from "node:crypto";
import {
  s,
  resource,
  operation,
  module,
  http,
  ok,
  error,
} from "@arc/framework";
export const User = s.object({
  id: s.uuid(),
  name: s.string({ min: 2, max: 100 }),
  email: s.email(),
});
type User = ReturnType<typeof User.parse>;
export const usersRepository = resource({
  id: "users.repository",
  instrument: ["find", "list", "create"],
  effects: ["memory.read", "memory.write"],
  open: () => {
    const users = new Map<string, User>([
      [
        "00000000-0000-4000-8000-000000000001",
        {
          id: "00000000-0000-4000-8000-000000000001",
          name: "Demo User",
          email: "demo@example.com",
        },
      ],
    ]);
    return {
      find: async (id: string) => users.get(id),
      list: async () => [...users.values()],
      create: async (name: string, email: string) => {
        if ([...users.values()].some((u) => u.email === email))
          return undefined;
        const user = { id: randomUUID(), name, email };
        users.set(user.id, user);
        return user;
      },
    };
  },
});
export const getUser = operation({
  id: "users.get",
  input: s.object({ id: s.uuid() }),
  output: User,
  needs: { users: usersRepository },
  errors: { USER_NOT_FOUND: 404 },
  run: async ({ input, users }) => {
    const user = await users.find(input.id);
    return user ? ok(user) : error("USER_NOT_FOUND");
  },
});
export const createUser = operation({
  id: "users.create",
  input: s.object({ name: s.string({ min: 2, max: 100 }), email: s.email() }),
  output: User,
  needs: { users: usersRepository },
  errors: { EMAIL_EXISTS: 409 },
  run: async ({ input, users }) => {
    const user = await users.create(input.name, input.email);
    return user ? ok(user) : error("EMAIL_EXISTS");
  },
});
export const listUsers = operation({
  id: "users.list",
  input: s.object({}),
  output: User.array(),
  needs: { users: usersRepository },
  run: async ({ users }) => ok(await users.list()),
});
export const users = module({
  id: "users",
  operations: [getUser, createUser, listUsers],
  routes: [
    http.get("/users", listUsers),
    http.get("/users/:id", getUser),
    http.post("/users", createUser, { status: 201 }),
  ],
});
