import { randomUUID } from "node:crypto";
import {
  s,
  resource,
  operation,
  module,
  http,
  ok,
  Fault,
} from "@arc/framework";
import { usersRepository } from "../users/index.ts";
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
const Order = s.object({
  id: s.uuid(),
  userId: s.uuid(),
  product: s.string({ min: 1, max: 100 }),
  quantity: s.int({ min: 1, max: 100 }),
  total: s.number({ min: 0 }),
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
  id: "orders.create",
  input: s.object({
    product: s.string({ min: 1, max: 100 }),
    quantity: s.int({ min: 1, max: 100 }),
  }),
  output: Order,
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
  id: "orders.list",
  input: s.object({}),
  output: Order.array(),
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
