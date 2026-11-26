export const ordersPath = "/orders";
export const orderDetailPattern = `${ordersPath}/:id`;

export function orderDetailPath(id: string): string {
  return `${ordersPath}/${encodeURIComponent(id)}`;
}
