import { s, operationContract } from "@arc/framework/core";

export const orderUnitPrice = 25;

export function orderTotal(quantity: number): number {
  return quantity * orderUnitPrice;
}

export const productMaxLength = 100;
export const quantityLimits = { min: 1, max: 100 } as const;
// Схема відповіді містить згенерований ID, власника та обчислену сервером суму.
export const Order = s.object({
  id: s.uuid(),
  userId: s.uuid(),
  product: s.string({ min: 1, max: productMaxLength }),
  quantity: s.int(quantityLimits),
  total: s.number({ min: 0 }),
  cancelled: s.boolean(),
});
export const orderFormFields = ["product", "quantity"] as const;
const orderIdentity = Order.pick("id");
const orderNotFound = { ORDER_NOT_FOUND: 404 } as const;

export function isOrderActive(order: { cancelled: boolean } | undefined): boolean {
  return order?.cancelled === false;
}

// ID зв’язує браузерний клієнт із серверною реалізацією. expose.web відкриває
// операцію для внутрішнього HTTP-транспорту ARC.
export const ListOrders = operationContract({
  id: "orders.list",
  input: s.object({}),
  output: Order.array(),
  expose: { web: true },
});

export const GetOrder = operationContract({
  id: "orders.get",
  input: orderIdentity,
  output: Order,
  errors: orderNotFound,
  expose: { web: true },
});

// Браузер передає товар і кількість. Сервер визначає власника за запитом і обчислює суму.
export const CreateOrder = operationContract({
  id: "orders.create",
  input: Order.pick(...orderFormFields),
  output: Order,
  expose: { web: true },
});

export const UpdateOrder = operationContract({
  id: "orders.update",
  input: Order.pick("id", ...orderFormFields),
  output: Order,
  errors: { ...orderNotFound, ORDER_ALREADY_CANCELLED: 409 },
  expose: { web: true },
});

export const CancelOrder = operationContract({
  id: "orders.cancel",
  input: orderIdentity,
  output: Order,
  errors: {
    ...orderNotFound,
    ORDER_ALREADY_CANCELLED: { status: 409, details: Order, updateFromDetails: true },
  },
  expose: { web: true },
});
