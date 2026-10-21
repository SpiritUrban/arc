import { randomUUID } from "node:crypto";
import { resource, operation, module, http, ok, Fault } from "@arc/framework";
import { usersRepository } from "../users/index.ts";
import { Order, ListOrders, CreateOrder } from "./contracts.ts";
const currentUser = resource({
  id: "auth.currentUser",
  scope: "request",
  needs: { users: usersRepository },
  open: async ({ request, users }) => {
    const id = request?.headers.get("authorization")?.replace(/^Bearer /, "");
    const user = id ? await users.find(id) : undefined;
    if (!user) throw new Fault("UNAUTHORIZED", 401);
    return user;
  },
});
type Order = ReturnType<typeof Order.parse>;
const ordersRepository = resource({
  id: "orders.repository",
  instrument: ["save", "list"],
  effects: ["memory.write"],
  open: () => {
    const orders: Order[] = [];
    return {
      save: async (order: Order) => {
        orders.push(order);
        return order;
      },
      list: async (userId: string) => orders.filter((o) => o.userId === userId),
    };
  },
});
export const createOrder = operation({
  ...CreateOrder,
  needs: { user: currentUser, orders: ordersRepository },
  effects: ["orders.write"],
  run: async ({ input, user, orders }) =>
    ok(
      await orders.save({
        id: randomUUID(),
        userId: user.id,
        ...input,
        total: input.quantity * 25,
      }),
    ),
});
const listOrders = operation({
  ...ListOrders,
  needs: { user: currentUser, orders: ordersRepository },
  run: async ({ user, orders }) => ok(await orders.list(user.id)),
});
export const orders = module({
  id: "orders",
  operations: [createOrder, listOrders],
  routes: [
    http.post("/orders", createOrder, { status: 201 }),
    http.get("/orders", listOrders),
  ],
});
