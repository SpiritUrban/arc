import { s, operationContract } from "@arc/framework/core";
export const Order = s.object({
  id: s.uuid(),
  userId: s.uuid(),
  product: s.string({ min: 1, max: 100 }),
  quantity: s.int({ min: 1, max: 100 }),
  total: s.number({ min: 0 }),
});
export const ListOrders = operationContract({
  id: "orders.list",
  input: s.object({}),
  output: Order.array(),
  expose: { web: true },
});
export const CreateOrder = operationContract({
  id: "orders.create",
  input: s.object({
    product: s.string({ min: 1, max: 100 }),
    quantity: s.int({ min: 1, max: 100 }),
  }),
  output: Order,
  expose: { web: true },
});
