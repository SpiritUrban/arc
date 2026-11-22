import type { Order } from "./contracts.ts";

export function orderHistory(
  orders: readonly Order[],
  search: string,
  status: string,
) {
  const term = search.trim().toLowerCase();
  return {
    count: orders.length,
    total: orders.reduce((sum, order) => sum + order.total, 0),
    filtering: !!term || status !== "all",
    rows: orders.filter(
      (order) =>
        order.product.toLowerCase().includes(term) &&
        (status === "all" || order.cancelled === (status === "cancelled")),
    ),
  };
}
