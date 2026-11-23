import { s, operationContract } from "@arc/framework/core";

export const orderUnitPrice = 25;
export const productMaxLength = 100;
export const quantityLimits = { min: 1, max: 100 } as const;
const orderFields = {
  product: s.string({ min: 1, max: productMaxLength }),
  quantity: s.int(quantityLimits),
};

// Схема відповіді містить згенерований ID, власника та обчислену сервером суму.
export const Order = s.object({
  id: s.uuid(),
  userId: s.uuid(),
  ...orderFields,
  total: s.number({ min: 0 }),
  cancelled: s.boolean(),
});

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
  input: s.object({ id: s.uuid() }),
  output: Order,
  errors: { ORDER_NOT_FOUND: 404 },
  expose: { web: true },
});

// Браузер передає товар і кількість. Сервер визначає власника за запитом і обчислює суму.
export const CreateOrder = operationContract({
  id: "orders.create",
  input: s.object(orderFields),
  output: Order,
  expose: { web: true },
});

export const UpdateOrder = operationContract({
  id: "orders.update",
  input: s.object({ id: s.uuid(), ...orderFields }),
  output: Order,
  errors: { ORDER_NOT_FOUND: 404, ORDER_ALREADY_CANCELLED: 409 },
  expose: { web: true },
});

export const CancelOrder = operationContract({
  id: "orders.cancel",
  input: s.object({ id: s.uuid() }),
  output: Order,
  errors: {
    ORDER_NOT_FOUND: 404,
    ORDER_ALREADY_CANCELLED: { status: 409, details: Order },
  },
  expose: { web: true },
});
