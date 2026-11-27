// Серверний модуль замовлень. app.ts підключає його до Workspace.
// Форма в orders/page.tsx надсилає POST /_arc/call/orders.create.
// ARC знаходить реалізацію за ID зі спільного контракту.
import { randomUUID } from "node:crypto";
import type { Infer } from "@arc/framework/core";
import {
  handlerModule,
  handles,
  http,
  ok,
  resource,
  type Fail,
  type HandlerContext,
} from "@arc/framework/server";
import { currentUser } from "../auth.ts";
import { ListOrders, GetOrder, CreateOrder, UpdateOrder, CancelOrder, compareOrderIds, isOrderActive, matchesOrderStatus, orderTotal, type Order, type OrderFormInput } from "./contracts.ts";
import { orderDetailPattern, ordersPath } from "./paths.ts";

type OrderEdit = Infer<typeof UpdateOrder.input>;
type OrderPatch = ReturnType<typeof priceOrderFields> | Pick<Order, "cancelled">;
type OrderChange =
  | Order
  | { error: "ORDER_NOT_FOUND" }
  | { error: "ORDER_ALREADY_CANCELLED"; order: Order };

function priceOrderFields(fields: OrderFormInput) {
  return { ...fields, total: orderTotal(fields.quantity) };
}

function orderChangeResult(result: OrderChange, fail: Fail<typeof UpdateOrder.errors>) {
  if (!("error" in result)) return ok(result);
  if (result.error === "ORDER_NOT_FOUND") return fail(result.error);
  return fail(result.error, result.order);
}

// Типовий scope ресурсу — application. ARC створює одне сховище у open,
// а методи працюють із ним під час усіх запитів цього запуску.
const ordersRepository = resource({
  id: "orders.repository",
  // ARC записує виклики цих методів у трасу. Їх можна побачити в Stand.
  instrument: ["save", "list", "find", "update", "cancel"],
  // effects описує побічні ефекти в метаданих ARC. Сам запис виконує метод save.
  effects: ["memory.write"],
  open: () => {
    const ordersByOwner = new Map<string, Map<string, Order>>();

    function find(id: string, userId: string) {
      return ordersByOwner.get(userId)?.get(id);
    }

    function save(order: Order): Order {
      let owned = ordersByOwner.get(order.userId);
      if (!owned) {
        owned = new Map();
        ordersByOwner.set(order.userId, owned);
      }
      owned.set(order.id, order);
      return order;
    }

    function changeOrder(id: string, userId: string, changes: OrderPatch): OrderChange {
      const current = find(id, userId);
      if (!current) return { error: "ORDER_NOT_FOUND" };
      if (!isOrderActive(current)) return { error: "ORDER_ALREADY_CANCELLED", order: current };
      return save({ ...current, ...changes });
    }

    return {
      save: async (order: Order) => save(order),
      async list(userId: string, filter: Infer<typeof ListOrders.input>) {
        const orders = Array.from(ordersByOwner.get(userId)?.values() ?? []);
        return filter.cancelled === undefined
          ? orders
          : orders.filter((order) => matchesOrderStatus(order, filter)).sort(compareOrderIds);
      },
      find: async (id: string, userId: string) => find(id, userId),
      async update({ id, ...changes }: OrderEdit, userId: string) {
        return changeOrder(id, userId, priceOrderFields(changes));
      },
      async cancel(id: string, userId: string) {
        return changeOrder(id, userId, { cancelled: true });
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
      ...priceOrderFields(input),
      id: randomUUID(),
      userId: user.id,
      cancelled: false,
    };
    return ok(await orders.save(order));
  },
});
const updateOrder = http.put(orderDetailPattern, UpdateOrder, {
  ...orderWrite,
  async run({ input, user, orders, fail }) {
    const result = await orders.update(input, user.id);
    return orderChangeResult(result, fail);
  },
});

const cancelOrder = http.post(`${ordersPath}/cancel`, CancelOrder, {
  ...orderWrite,
  async run({ input, user, orders, fail }) {
    const result = await orders.cancel(input.id, user.id);
    return orderChangeResult(result, fail);
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
  static async listOrders({ input, user, orders }: HandlerContext<typeof ListOrders, typeof needs>) {
    return ok(await orders.list(user.id, input));
  }
}

export const orders = handlerModule("orders", Orders, {
  routes: [createOrder, updateOrder, cancelOrder],
});
