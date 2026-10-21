import { s, operationContract } from "@arc/framework/core";
export const User = s.object({
  id: s.uuid(),
  name: s.string({ min: 2, max: 100 }),
  email: s.email(),
});
export const ListUsers = operationContract({
  id: "users.list",
  input: s.object({}),
  output: User.array(),
  expose: { web: true },
});
export const CreateUser = operationContract({
  id: "users.create",
  input: s.object({ name: s.string({ min: 2, max: 100 }), email: s.email() }),
  output: User,
  errors: { EMAIL_EXISTS: 409 },
  expose: { web: true },
});
