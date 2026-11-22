import { queryOptions } from "@tanstack/react-query";
import { readResponse } from "../http.ts";
import { orderSchema, ordersSchema, type OrderInput } from "./contracts.ts";

export const ordersKey = (id: string) => ["orders", id] as const;

async function listOrders(owner: string, signal: AbortSignal) {
  const response = await fetch("/api/orders", {
    headers: { authorization: `Bearer ${owner}` },
    signal,
  });
  return ordersSchema.parse(await readResponse(response));
}

export const ordersQuery = (owner: string) =>
  queryOptions({
    queryKey: ordersKey(owner),
    queryFn: ({ signal }) => listOrders(owner, signal),
  });

export async function createOrder(owner: string, input: OrderInput) {
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: {
      authorization: `Bearer ${owner}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return orderSchema.parse(await readResponse(response));
}
