import { state } from "@arc/framework/web";
import { query } from "@arc/framework/fullstack";
import { ListUsers, demoUserId } from "./users/contracts.ts";

// Список користувачів і замовлення читають один і той самий вибір.
// Після зміни ID клієнт замовлень перезавантажує дані для нового користувача.
export const selectedUser = state({
  id: "workspace.selected-user",
  initial: demoUserId,
});

export const users = query(ListUsers);

export const activeUser = users.findById(selectedUser);
