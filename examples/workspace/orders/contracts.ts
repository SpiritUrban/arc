import { s, operationContract, type Infer } from "@arc/framework/core";

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
  revision: s.int({ min: 1 }),
  product: s.string({ min: 1, max: productMaxLength }),
  quantity: s.int(quantityLimits),
  total: s.number({ min: 0 }),
  cancelled: s.boolean(),
});
export type Order = Infer<typeof Order>;

export function isOrderActive(order: { cancelled: boolean } | undefined): boolean {
  return order?.cancelled === false;
}

export function matchesOrderStatus(order: Order, { cancelled }: { cancelled?: boolean }): boolean {
  return cancelled === undefined || order.cancelled === cancelled;
}

export function compareOrderIds(left: Order, right: Order): number {
  return left.id.localeCompare(right.id);
}

// ID зв’язує браузерний клієнт із серверною реалізацією. expose.web відкриває
// операцію для внутрішнього HTTP-транспорту ARC.
export const ListOrders = operationContract({
  id: "orders.list",
  input: s.object({ cancelled: s.boolean().optional() }),
  output: Order.array(),
  expose: { web: true },
});

export const GetOrder = operationContract({
  id: "orders.get",
  input: Order.pick("id"),
  output: Order,
  errors: { ORDER_NOT_FOUND: 404 },
  expose: { web: true },
});

const orderChangeErrors = {
  ...GetOrder.errors,
  ORDER_ALREADY_CANCELLED: { status: 409, details: GetOrder.output, updateFromDetails: true },
} as const;

// Браузер передає товар і кількість. Сервер визначає власника за запитом і обчислює суму.
export const CreateOrder = operationContract({
  id: "orders.create",
  input: Order.pick("product", "quantity"),
  output: Order,
  expose: { web: true },
});
export type OrderFormInput = Infer<typeof CreateOrder.input>;

export const UpdateOrder = operationContract({
  id: "orders.update",
  input: CreateOrder.output.pick(GetOrder.input, CreateOrder.input),
  output: CreateOrder.output,
  errors: orderChangeErrors,
  expose: { web: true },
});

export const CancelOrder = operationContract({
  id: "orders.cancel",
  input: GetOrder.input,
  output: GetOrder.output,
  errors: orderChangeErrors,
  expose: { web: true },
});
