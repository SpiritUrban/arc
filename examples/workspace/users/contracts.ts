import { s, operationContract } from "@arc/framework/core";
// Поля профілю мають одне визначення для output і обох write-контрактів.
const userFields = {
  name: s.string({ min: 2, max: 100 }),
  email: s.email(),
};
export const UserProfile = s.object(userFields);
export const User = s.object({ id: s.uuid(), ...userFields });
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
  input: s.object({ id: s.uuid(), ...userFields }),
  output: User,
  errors: { USER_NOT_FOUND: 404, EMAIL_EXISTS: emailExists },
  expose: { web: true },
});
