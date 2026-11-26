import type { RemoteResult } from "@arc/framework/fullstack";
import { failureMessage } from "../ui.ts";
import type { CancelOrder, UpdateOrder } from "./contracts.ts";

export const orderStatuses = {
  created: { label: "Створено", filterLabel: "Створені" },
  cancelled: { label: "Скасовано", filterLabel: "Скасовані" },
} as const;

export function orderStatus(order: { cancelled: boolean }): keyof typeof orderStatuses {
  return order.cancelled ? "cancelled" : "created";
}

type WriteOutcome = {
  readonly result: RemoteResult<typeof CancelOrder> | RemoteResult<typeof UpdateOrder> | undefined;
  readonly error: unknown;
};

export function orderWriteMessage(
  outcome: WriteOutcome | undefined,
  conflict: string,
  fallback: (error: unknown) => string = failureMessage,
) {
  const { result, error } = outcome ?? {};
  if (!error) return "";
  if (result?.kind === "business_error") {
    if (result.error === "ORDER_ALREADY_CANCELLED") return conflict;
    if (result.error === "ORDER_NOT_FOUND") return "Замовлення не знайдено.";
  }
  return fallback(error);
}
