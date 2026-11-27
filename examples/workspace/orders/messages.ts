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

const orderWriteMessages = {
  cancel: {
    conflict: "Замовлення вже скасовано.",
    fallback: "Не вдалося скасувати замовлення.",
  },
  update: {
    conflict: "Скасоване замовлення не можна редагувати.",
    fallback: "Не вдалося зберегти замовлення.",
  },
};

export function orderWriteMessage(
  outcome: WriteOutcome | undefined,
  action: keyof typeof orderWriteMessages,
) {
  const { result, error } = outcome ?? {};
  if (!error) return "";
  const { conflict, fallback } = orderWriteMessages[action];
  if (result?.kind === "business_error") {
    if (result.error === "ORDER_ALREADY_CANCELLED") return conflict;
    if (result.error === "ORDER_NOT_FOUND") return "Замовлення не знайдено.";
  }
  return action === "cancel" && result?.kind === "fault" && result.fault.code === "UNAUTHORIZED"
    ? failureMessage(error)
    : fallback;
}
