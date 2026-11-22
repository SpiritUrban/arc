import { z } from "zod";

export const orderUnitPrice = 25;

export const orderInputSchema = z.object({
  product: z.string().trim().min(1).max(100),
  quantity: z.int().min(1).max(100),
});

export const orderSchema = orderInputSchema.extend({
  id: z.uuid(),
  userId: z.uuid(),
  total: z.number().nonnegative(),
  cancelled: z.boolean(),
});

export const ordersSchema = z.array(orderSchema);
export type OrderInput = z.infer<typeof orderInputSchema>;
export type Order = z.infer<typeof orderSchema>;
