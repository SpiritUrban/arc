import { s, operationContract } from "@arc/framework/core";
// Схема відповіді містить згенерований ID, власника та обчислену сервером суму.

export const Order = s.object({
  id: s.uuid(),
  userId: s.uuid(),
  product: s.string({ min: 1, max: 100 }),
  quantity: s.int({ min: 1, max: 100 }),
  total: s.number({ min: 0 }),
});

// ID зв’язує браузерний клієнт із серверною реалізацією. expose.web відкриває
// операцію для внутрішнього HTTP-транспорту ARC.
export const ListOrders = operationContract({
  id: "orders.list",
  input: s.object({}),
  output: Order.array(),
  expose: { web: true },
});

// Браузер передає товар і кількість. Сервер визначає власника за запитом і обчислює суму.
export const CreateOrder = operationContract({
  id: "orders.create",
  input: s.object({
    product: s.string({ min: 1, max: 100 }),
    // Обмеження зі схеми перевіряється на сервері навіть при прямому HTTP-запиті.
    quantity: s.int({ min: 1, max: 100 }),
  }),
  output: Order,
  expose: { web: true },
});
