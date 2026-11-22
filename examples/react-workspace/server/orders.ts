import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  orderInputSchema,
  orderUnitPrice,
  type Order,
} from "../src/orders/contracts.ts";
import { readJson, sendJson } from "./json.ts";
import { findUser } from "./users.ts";

const orders: Order[] = [];

export async function handleOrders(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
) {
  if (
    path !== "/api/orders" ||
    (request.method !== "GET" && request.method !== "POST")
  )
    return false;

  const ownerId = /^Bearer (.+)$/.exec(
    request.headers.authorization ?? "",
  )?.[1];
  if (!ownerId || !findUser(ownerId)) {
    sendJson(response, 401, { error: "UNAUTHORIZED" });
    return true;
  }
  if (request.method === "GET") {
    sendJson(
      response,
      200,
      orders.filter((order) => order.userId === ownerId),
    );
    return true;
  }
  const input = await readJson(request, response, orderInputSchema);
  if (input) {
    const order: Order = {
      ...input.data,
      id: randomUUID(),
      userId: ownerId,
      total: input.data.quantity * orderUnitPrice,
      cancelled: false,
    };
    orders.push(order);
    sendJson(response, 201, order);
  }
  return true;
}
