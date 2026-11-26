import { routePath } from "@arc/framework/core";

export const ordersPath = "/orders";
export const orderDetailPattern = `${ordersPath}/:id`;

export function orderDetailPath(id: string): string {
  return routePath(orderDetailPattern, { id });
}
