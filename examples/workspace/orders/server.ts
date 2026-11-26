// Серверний модуль замовлень. app.ts підключає його до Workspace.
// Форма в orders/page.tsx надсилає POST /_arc/call/orders.create.
// ARC знаходить реалізацію за ID зі спільного контракту.
import { randomUUID } from "node:crypto";
import {
  handlerModule,
  handles,
  http,
  ok,
  resource,
  type HandlerContext,
} from "@arc/framework/server";
import { currentUser } from "../auth.ts";
import { Order, ListOrders, GetOrder, CreateOrder, UpdateOrder, CancelOrder, isOrderActive, orderTotal } from "./contracts.ts";
import { orderDetailPattern, ordersPath } from "./paths.ts";

// Імпортований Order є схемою перевірки. Локальний тип Order описує дані після parse.
type Order = ReturnType<typeof Order.parse>;
type OrderEdit = ReturnType<typeof UpdateOrder.input.parse>;

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
    const belongsToUser = (order: Order, userId: string) => order.userId === userId;
    const findOrderIndex = (id: string, userId: string) =>
      orders.findIndex((order) => order.id === id && belongsToUser(order, userId));

    return {
      save: async (order: Order) => {
        orders.push(order);
        return order;
      },
      // Вибірка обмежена власником, якого передає серверна операція.
      list: async (userId: string) => orders.filter((order) => belongsToUser(order, userId)),
      find: async (id: string, userId: string) => {
        const index = findOrderIndex(id, userId);
        return index < 0 ? undefined : orders[index];
      },
      async update({ id, ...changes }: OrderEdit, userId: string) {
        const index = findOrderIndex(id, userId);
        if (index < 0) return "ORDER_NOT_FOUND" as const;
        const current = orders[index];
        if (!isOrderActive(current)) return "ORDER_ALREADY_CANCELLED" as const;
        const order = { ...current, ...changes, total: orderTotal(changes.quantity) };
        orders[index] = order;
        return order;
      },
      async cancel(id: string, userId: string) {
        const index = findOrderIndex(id, userId);
        if (index < 0) return "ORDER_NOT_FOUND" as const;
        const current = orders[index];
        if (!isOrderActive(current)) return { order: current, alreadyCancelled: true } as const;
        const order = { ...current, cancelled: true };
        orders[index] = order;
        return { order, alreadyCancelled: false } as const;
      },
    };
  },
});

const needs = { user: currentUser, orders: ordersRepository };
const orderWrite = { needs, effects: ["orders.write"] };
const createOrder = http.post(ordersPath, CreateOrder, {
  ...orderWrite,
  status: 201,
  async run({ input, user, orders }) {
    const order = {
      ...input,
      id: randomUUID(),
      userId: user.id,
      total: orderTotal(input.quantity),
      cancelled: false,
    };
    return ok(await orders.save(order));
  },
});
const updateOrder = http.put(orderDetailPattern, UpdateOrder, {
  ...orderWrite,
  async run({ input, user, orders, fail }) {
    const result = await orders.update(input, user.id);
    return typeof result === "string" ? fail(result) : ok(result);
  },
});

const cancelOrder = http.post(`${ordersPath}/cancel`, CancelOrder, {
  ...orderWrite,
  async run({ input, user, orders, fail }) {
    const result = await orders.cancel(input.id, user.id);
    if (typeof result === "string") return fail(result);
    return result.alreadyCancelled ? fail("ORDER_ALREADY_CANCELLED", result.order) : ok(result.order);
  },
});

class Orders {
  @handles(GetOrder, {
    needs,
    route: { method: "GET", path: orderDetailPattern },
  })
  static async getOrder({ input, user, orders, fail }: HandlerContext<typeof GetOrder, typeof needs>) {
    const order = await orders.find(input.id, user.id);
    return order ? ok(order) : fail("ORDER_NOT_FOUND");
  }

  @handles(ListOrders, {
    needs,
    route: { method: "GET", path: ordersPath },
  })
  static async listOrders({ user, orders }: HandlerContext<typeof ListOrders, typeof needs>) {
    return ok(await orders.list(user.id));
  }
}

export const orders = handlerModule("orders", Orders, {
  routes: [createOrder, updateOrder, cancelOrder],
});
