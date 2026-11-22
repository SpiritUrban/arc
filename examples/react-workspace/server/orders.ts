import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  cancelOrderSchema,
  orderIdSchema,
  orderInputSchema,
  orderUnitPrice,
  type Order,
} from "../src/orders/contracts.ts";
import { readJson, sendJson } from "./json.ts";
import { findUser } from "./users.ts";

const orders = new Map<string, Order>();

export async function handleOrders(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
) {
  const member = /^\/api\/orders\/([^/]+)$/.exec(path);
  const method = request.method;
  const collection =
    path === "/api/orders" && (method === "GET" || method === "POST");
  const cancelling = path === "/api/orders/cancel" && method === "POST";
  if (
    !collection &&
    !cancelling &&
    !(member && (method === "GET" || method === "PUT"))
  ) {
    return false;
  }

  const ownerId = /^Bearer (.+)$/.exec(
    request.headers.authorization ?? "",
  )?.[1];
  if (!ownerId || !findUser(ownerId)) {
    sendJson(response, 401, { error: "UNAUTHORIZED" });
    return true;
  }
  if (collection) {
    if (method === "GET") {
      sendJson(
        response,
        200,
        [...orders.values()].filter((order) => order.userId === ownerId),
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
      orders.set(order.id, order);
      sendJson(response, 201, order);
    }
    return true;
  }

  let id: string;
  if (cancelling) {
    const input = await readJson(request, response, cancelOrderSchema);
    if (!input) return true;
    id = input.data.id;
  } else {
    try {
      id = decodeURIComponent(member![1]);
    } catch {
      sendJson(response, 400, { error: "INVALID_PATH" });
      return true;
    }
    if (!orderIdSchema.safeParse(id).success) {
      sendJson(response, 400, { error: "VALIDATION_ERROR", fields: ["id"] });
      return true;
    }
  }

  const edit =
    method === "PUT"
      ? await readJson(request, response, orderInputSchema)
      : undefined;
  if (method === "PUT" && !edit) return true;
  const order = orders.get(id);
  if (!order || order.userId !== ownerId) {
    sendJson(response, 404, { error: "ORDER_NOT_FOUND" });
  } else if (method === "GET") {
    sendJson(response, 200, order);
  } else if (order.cancelled) {
    sendJson(response, 409, { error: "ORDER_ALREADY_CANCELLED" });
  } else {
    const saved = edit
      ? { ...order, ...edit.data, total: edit.data.quantity * orderUnitPrice }
      : { ...order, cancelled: true };
    orders.set(id, saved);
    sendJson(response, 200, saved);
  }
  return true;
}
