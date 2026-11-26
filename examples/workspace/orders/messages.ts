import type { RemoteResult } from "@arc/framework/fullstack";
import { failureMessage } from "../ui.ts";
import { isOrderActive, type CancelOrder, type UpdateOrder } from "./contracts.ts";

export const orderStatuses = {
  created: { label: "Створено", filterLabel: "Створені" },
  cancelled: { label: "Скасовано", filterLabel: "Скасовані" },
} as const;

export function orderStatus(order: { cancelled: boolean }): keyof typeof orderStatuses {
  return isOrderActive(order) ? "created" : "cancelled";
}

type WriteOutcome = {
  readonly result: RemoteResult<typeof CancelOrder> | RemoteResult<typeof UpdateOrder> | undefined;
  readonly error: unknown;
};

export function orderWriteMessage(
  outcome: WriteOutcome | undefined,
  conflict: string,
  fallback?: string,
) {
  const { result, error } = outcome ?? {};
  if (!error) return "";
  if (result?.kind === "business_error") {
    if (result.error === "ORDER_ALREADY_CANCELLED") return conflict;
    if (result.error === "ORDER_NOT_FOUND") return "Замовлення не знайдено.";
  }
  return fallback ?? failureMessage(error);
}
