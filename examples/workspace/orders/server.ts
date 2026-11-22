// Серверний модуль замовлень. app.ts підключає його до Workspace.
// Форма в orders/page.tsx надсилає POST /_arc/call/orders.create.
// ARC знаходить реалізацію за ID зі спільного контракту.
import { randomUUID } from "node:crypto";
import {
  error,
  handlerModule,
  handles,
  http,
  module,
  ok,
  resource,
  type HandlerContext,
  type OperationContract,
} from "@arc/framework/server";
import { currentUser } from "../auth.ts";
import { Order, ListOrders, GetOrder, CreateOrder, UpdateOrder, CancelOrder } from "./contracts.ts";

// Імпортований Order є схемою перевірки. Локальний тип Order описує дані після parse.
type Order = ReturnType<typeof Order.parse>;

// Типовий scope ресурсу — application. ARC створює один масив у open,
// а методи працюють із ним під час усіх запитів цього запуску.
const ordersRepository = resource({
  id: "orders.repository",
  // ARC записує виклики цих методів у трасу. Їх можна побачити в Stand.
  instrument: ["save", "list", "find", "update", "cancel"],
  // effects описує побічні ефекти в метаданих ARC. Сам запис виконує метод save.
  effects: ["memory.write"],
  open: () => {
    const orders: Order[] = [];
    return {
      save: async (order: Order) => {
        orders.push(order);
        return order;
      },
      // Вибірка обмежена власником, якого передає серверна операція.
      list: async (userId: string) => orders.filter((o) => o.userId === userId),
      find: async (id: string, userId: string) =>
        orders.find((order) => order.id === id && order.userId === userId),
      async update(id: string, userId: string, product: string, quantity: number) {
        const index = orders.findIndex((order) => order.id === id && order.userId === userId);
        if (index < 0) return "ORDER_NOT_FOUND" as const;
        if (orders[index].cancelled) return "ORDER_ALREADY_CANCELLED" as const;
        const order = { ...orders[index], product, quantity, total: quantity * 25 };
        orders[index] = order;
        return order;
      },
      async cancel(id: string, userId: string) {
        const index = orders.findIndex((order) => order.id === id && order.userId === userId);
        if (index < 0) return "ORDER_NOT_FOUND" as const;
        const current = orders[index];
        if (current.cancelled) return { order: current, alreadyCancelled: true } as const;
        const order = { ...current, cancelled: true };
        orders[index] = order;
        return { order, alreadyCancelled: false } as const;
      },
    };
  },
});

const needs = { user: currentUser, orders: ordersRepository };
const getOrder = http.get("/orders/:id", GetOrder, {
  needs,
  async run({ input, user, orders }) {
    const order = await orders.find(input.id, user.id);
    return order ? ok(order) : error("ORDER_NOT_FOUND");
  },
});
const createOrder = http.post("/orders", CreateOrder, {
  status: 201,
  needs,
  effects: ["orders.write"],
  async run({ input, user, orders }) {
    const order = {
      ...input,
      id: randomUUID(),
      userId: user.id,
      total: input.quantity * 25,
      cancelled: false,
    };
    return ok(await orders.save(order));
  },
});
const updateOrder = http.put("/orders/:id", UpdateOrder, {
  needs,
  effects: ["orders.write"],
  async run({ input, user, orders }) {
    const result = await orders.update(input.id, user.id, input.product, input.quantity);
    return typeof result === "string" ? error(result) : ok(result);
  },
});

const cancelOrder = http.post("/orders/cancel", CancelOrder, {
  needs,
  effects: ["orders.write"],
  async run({ input, user, orders, fail }) {
    const result = await orders.cancel(input.id, user.id);
    if (typeof result === "string") return fail(result);
    return result.alreadyCancelled ? fail("ORDER_ALREADY_CANCELLED", result.order) : ok(result.order);
  },
});

type OrderContext<C extends OperationContract> = HandlerContext<
  C,
  typeof needs
>;

class Orders {
  @handles(ListOrders, {
    needs,
    route: { method: "GET", path: "/orders" },
  })
  static async listOrders({ user, orders }: OrderContext<typeof ListOrders>) {
    return ok(await orders.list(user.id));
  }
}

const listOrders = handlerModule("orders", Orders);
export const orders = module({
  ...listOrders,
  routes: [getOrder, createOrder, updateOrder, cancelOrder, ...(listOrders.routes ?? [])],
});
