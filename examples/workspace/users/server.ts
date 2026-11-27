// Серверна частина користувачів. Тут зберігаються записи,
// виконуються операції та визначаються HTTP-маршрути.
import { randomUUID } from "node:crypto";
import type { Infer } from "@arc/framework/core";
import {
  resource,
  module,
  http,
  ok,
} from "@arc/framework";
import { ListUsers, GetUser, CreateUser, UpdateUser, demoUserId, type User, type UserProfile } from "./contracts.ts";
export { User } from "./contracts.ts";

type UserEdit = Infer<typeof UpdateUser.input>;

// Сховище живе в пам’яті одного запуску. Початковий запис дає Workspace демо-користувача.
export const usersRepository = resource({
  id: "users.repository",
  // instrument додає виклики методів до трас. effects описує читання й запис у графі.
  instrument: ["find", "list", "create", "update"],
  effects: ["memory.read", "memory.write"],
  open: () => {
    const demoUser: User = {
      id: demoUserId,
      name: "Demo User",
      email: "demo@example.com",
    };
    const users = new Map([[demoUser.id, demoUser]]);
    const usersByEmail = new Map([[demoUser.email, demoUser.id]]);
    const emailExists = (email: string, exceptId?: string) => {
      const owner = usersByEmail.get(email);
      return owner !== undefined && owner !== exceptId;
    };

    function save(user: User): User {
      const previous = users.get(user.id);
      if (previous && previous.email !== user.email) usersByEmail.delete(previous.email);
      users.set(user.id, user);
      usersByEmail.set(user.email, user.id);
      return user;
    }

    return {
      find: async (id: string) => users.get(id),
      list: async () => [...users.values()],
      // Пошту перевіряємо серед записів. undefined дає операції сигнал повернути EMAIL_EXISTS.
      create: async (profile: UserProfile) => {
        if (emailExists(profile.email)) return undefined;
        return save({ id: randomUUID(), ...profile });
      },
      update: async (input: UserEdit) => {
        const current = users.get(input.id);
        if (!current) return "USER_NOT_FOUND" as const;
        if (emailExists(input.email, input.id)) return "EMAIL_EXISTS" as const;
        return save({ ...current, ...input });
      },
    };
  },
});
const needs = { users: usersRepository };
const usersPath = "/users";
const userDetailPath = `${usersPath}/:id`;

const getUser = http.get(userDetailPath, GetUser, {
  needs,
  run: async ({ input, users, fail }) => {
    const user = await users.find(input.id);
    return user ? ok(user) : fail("USER_NOT_FOUND");
  },
});

const createUser = http.post(usersPath, CreateUser, {
  status: 201,
  needs,
  run: async ({ input, users, fail }) => {
    const user = await users.create(input);
    // Дублікат пошти повертаємо як бізнес-помилку, яку форма може показати користувачу.
    return user ? ok(user) : fail("EMAIL_EXISTS");
  },
});

const updateUser = http.put(userDetailPath, UpdateUser, {
  needs,
  run: async ({ input, users, fail }) => {
    const result = await users.update(input);
    return typeof result === "string" ? fail(result) : ok(result);
  },
});

const listUsers = http.get(usersPath, ListUsers, {
  needs,
  run: async ({ users }) => ok(await users.list()),
});
export const users = module({
  id: "users",
  routes: [listUsers, getUser, createUser, updateUser],
});
