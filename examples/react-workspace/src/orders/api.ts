import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { readResponse } from "../http.ts";
import {
  orderSchema,
  ordersSchema,
  type Order,
  type OrderInput,
} from "./contracts.ts";

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

export function createOrder(owner: string, input: OrderInput) {
  return writeOrder(owner, "/api/orders", "POST", input);
}

export const orderKey = (owner: string, id: string) =>
  ["order", owner, id] as const;

export const orderQuery = (owner: string, id: string) =>
  queryOptions({
    queryKey: orderKey(owner, id),
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/orders/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${owner}` },
        signal,
      });
      return orderSchema.parse(await readResponse(response));
    },
  });

async function writeOrder(
  owner: string,
  path: string,
  method: string,
  input: object,
) {
  const response = await fetch(path, {
    method,
    headers: {
      authorization: `Bearer ${owner}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return orderSchema.parse(await readResponse(response));
}

export function updateOrder(owner: string, id: string, input: OrderInput) {
  return writeOrder(
    owner,
    `/api/orders/${encodeURIComponent(id)}`,
    "PUT",
    input,
  );
}

export function cancelOrder(owner: string, id: string) {
  return writeOrder(owner, "/api/orders/cancel", "POST", { id });
}

export async function saveConfirmedOrder(cache: QueryClient, order: Order) {
  const list = ordersKey(order.userId);
  const detail = orderKey(order.userId, order.id);
  await Promise.all([
    cache.cancelQueries({ queryKey: list, exact: true }),
    cache.cancelQueries({ queryKey: detail, exact: true }),
  ]);
  cache.setQueryData(detail, order);
  cache.setQueryData<Order[]>(list, (current) =>
    current?.map((item) => (item.id === order.id ? order : item)),
  );
}
