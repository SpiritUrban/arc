import { s, operationContract } from "@arc/framework/core";
// Схема User спільна для відповіді зі списком і відповіді після створення.
export const User = s.object({
  id: s.uuid(),
  name: s.string({ min: 2, max: 100 }),
  email: s.email(),
});
// Сервер і браузер використовують ті самі схеми. Реалізація операцій знаходиться в server.ts.
export const ListUsers = operationContract({
  id: "users.list",
  input: s.object({}),
  output: User.array(),
  expose: { web: true },
});
// Клієнт передає ім’я й пошту. Під час створення сервер генерує ID
// і повертає оголошену тут помилку EMAIL_EXISTS із HTTP 409, якщо пошта зайнята.
export const CreateUser = operationContract({
  id: "users.create",
  input: s.object({ name: s.string({ min: 2, max: 100 }), email: s.email() }),
  output: User,
  errors: { EMAIL_EXISTS: 409 },
  expose: { web: true },
});

export const UpdateUser = operationContract({
  id: "users.update",
  input: s.object({
    id: s.uuid(),
    name: s.string({ min: 2, max: 100 }),
    email: s.email(),
  }),
  output: User,
  errors: { USER_NOT_FOUND: 404, EMAIL_EXISTS: 409 },
  expose: { web: true },
});
