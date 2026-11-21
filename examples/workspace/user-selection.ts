import { derive, state } from "@arc/framework/web";
import { remote } from "@arc/framework/fullstack";
import { ListUsers } from "./users/contracts.ts";

// Список користувачів і замовлення читають один і той самий вибір.
// Після зміни ID клієнт замовлень перезавантажує дані для нового користувача.
export const selectedUser = state({
  id: "workspace.selected-user",
  initial: "00000000-0000-4000-8000-000000000001",
});

export const usersData = remote(ListUsers, { id: "users.current" });

export const activeUser = derive({
  id: "users.active",
  from: [usersData.data, selectedUser],
  compute: (users, id) => users?.find((user) => user.id === id),
});
