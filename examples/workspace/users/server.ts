// Серверна частина користувачів. Тут зберігаються записи,
// виконуються операції та визначаються HTTP-маршрути.
import { randomUUID } from "node:crypto";
import {
  resource,
  operation,
  module,
  http,
  ok,
  error,
} from "@arc/framework";
import { User, ListUsers, CreateUser, UpdateUser, demoUserId } from "./contracts.ts";
export { User } from "./contracts.ts";
type User = ReturnType<typeof User.parse>;
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
    return {
      find: async (id: string) => users.get(id),
      list: async () => [...users.values()],
      // Пошту перевіряємо серед записів. undefined дає операції сигнал повернути EMAIL_EXISTS.
      create: async (name: string, email: string) => {
        if ([...users.values()].some((u) => u.email === email))
          return undefined;
        const user = { id: randomUUID(), name, email };
        users.set(user.id, user);
        return user;
      },
      update: async (id: string, name: string, email: string) => {
        const current = users.get(id);
        if (!current) return "USER_NOT_FOUND" as const;
        if ([...users.values()].some((user) => user.id !== id && user.email === email))
          return "EMAIL_EXISTS" as const;
        const user = { id, name, email };
        users.set(id, user);
        return user;
      },
    };
  },
});
// REST-маршрут GET /users/:id передає ID у цю операцію. Відсутній запис дає HTTP 404.
export const getUser = operation({
  id: "users.get",
  input: User.pick("id"),
  output: User,
  needs: { users: usersRepository },
  errors: { USER_NOT_FOUND: 404 },
  run: async ({ input, users }) => {
    const user = await users.find(input.id);
    return user ? ok(user) : error("USER_NOT_FOUND");
  },
});

// Контракт описує дані, needs підключає сховище, а run повертає результат операції.
export const createUser = operation(CreateUser, {
  needs: { users: usersRepository },
  run: async ({ input, users }) => {
    const user = await users.create(input.name, input.email);
    // Дублікат пошти повертаємо як бізнес-помилку, яку форма може показати користувачу.
    return user ? ok(user) : error("EMAIL_EXISTS");
  },
});

export const updateUser = operation(UpdateUser, {
  needs: { users: usersRepository },
  run: async ({ input, users }) => {
    const result = await users.update(input.id, input.name, input.email);
    return typeof result === "string" ? error(result) : ok(result);
  },
});

// Список використовують і REST-маршрут GET /users, і браузерний remote(ListUsers).
export const listUsers = operation(ListUsers, {
  needs: { users: usersRepository },
  run: async ({ users }) => ok(await users.list()),
});
// Модуль реєструє операції та прив’язує частину з них до звичайних HTTP-маршрутів.
export const users = module({
  id: "users",
  operations: [getUser, createUser, updateUser, listUsers],
  routes: [
    http.get("/users", listUsers),
    http.get("/users/:id", getUser),
    http.post("/users", createUser, { status: 201 }),
    http.put("/users/:id", updateUser),
  ],
});
