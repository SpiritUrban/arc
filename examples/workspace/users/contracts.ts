import { s, operationContract } from "@arc/framework/core";

export const demoUserId = "00000000-0000-4000-8000-000000000001";

// Поля профілю мають одне визначення для output і обох write-контрактів.
export const User = s.object({
  id: s.uuid(),
  name: s.string({ min: 2, max: 100 }),
  email: s.email(),
});
export const UserProfile = User.pick("name", "email");
// Сервер і браузер використовують ті самі схеми. Реалізація операцій знаходиться в server.ts.
export const ListUsers = operationContract({
  id: "users.list",
  input: s.object({}),
  output: User.array(),
  expose: { web: true },
});
// Клієнт передає ім’я й пошту. Під час створення сервер генерує ID
// і повертає оголошену тут помилку EMAIL_EXISTS із HTTP 409, якщо пошта зайнята.
const emailExists = { status: 409, field: "email" } as const;
export const CreateUser = operationContract({
  id: "users.create",
  input: UserProfile,
  output: User,
  errors: { EMAIL_EXISTS: emailExists },
  expose: { web: true },
});

export const UpdateUser = operationContract({
  id: "users.update",
  input: User.pick("id", "name", "email"),
  output: User,
  errors: { USER_NOT_FOUND: 404, EMAIL_EXISTS: emailExists },
  expose: { web: true },
});
