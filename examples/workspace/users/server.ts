// Серверна частина користувачів. Тут зберігаються записи,
// виконуються операції та визначаються HTTP-маршрути.
import { randomUUID } from "node:crypto";
import {
  resource,
  module,
  http,
  ok,
} from "@arc/framework";
import { User, UserProfile, ListUsers, GetUser, CreateUser, UpdateUser, demoUserId } from "./contracts.ts";
export { User } from "./contracts.ts";
type User = ReturnType<typeof User.parse>;
type UserProfile = ReturnType<typeof UserProfile.parse>;
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
    const emailExists = (email: string, exceptId?: string) =>
      [...users.values()].some((user) => user.email === email && user.id !== exceptId);

    return {
      find: async (id: string) => users.get(id),
      list: async () => [...users.values()],
      // Пошту перевіряємо серед записів. undefined дає операції сигнал повернути EMAIL_EXISTS.
      create: async (profile: UserProfile) => {
        if (emailExists(profile.email)) return undefined;
        const user = { id: randomUUID(), ...profile };
        users.set(user.id, user);
        return user;
      },
      update: async (user: User) => {
        if (!users.has(user.id)) return "USER_NOT_FOUND" as const;
        if (emailExists(user.email, user.id)) return "EMAIL_EXISTS" as const;
        users.set(user.id, user);
        return user;
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
