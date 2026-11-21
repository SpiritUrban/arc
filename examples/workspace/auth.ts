import { resource, Fault } from "@arc/framework/server";
import { usersRepository } from "./users/server.ts";

// currentUser визначає, від імені кого виконувати операцію із замовленнями.
// scope: "request" прив’язує отримане значення до одного запиту.
export const currentUser = resource({
  id: "auth.currentUser",
  scope: "request",
  needs: { users: usersRepository },
  open: async ({ request, users }) => {
    // ARC передає в open HTTP-запит і сховище users із needs.
    // Для демо браузер надсилає UUID вибраного користувача як Authorization: Bearer <uuid>.
    const id = request?.headers.get("authorization")?.replace(/^Bearer /, "");
    const user = id ? await users.find(id) : undefined;
    // Якщо заголовка немає або UUID не знайдено, ARC повертає 401 ще до виклику run.
    if (!user) throw new Fault("UNAUTHORIZED", 401);
    return user;
  },
});
