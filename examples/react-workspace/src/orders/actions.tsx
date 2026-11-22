import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { ApiError } from "../http.ts";
import { cancelOrder, saveConfirmedOrder } from "./api.ts";

export const orderWriteKey = (owner: string, id: string) => [
  "order.write",
  owner,
  id,
];

export function orderError(error: Error, fallback: string) {
  if (error instanceof ApiError) {
    if (error.message === "ORDER_ALREADY_CANCELLED")
      return "Це замовлення вже скасовано.";
    if (error.message === "ORDER_NOT_FOUND") return "Замовлення не знайдено.";
  }
  return fallback;
}

export function CancelOrder({ owner, id }: { owner: string; id: string }) {
  const cache = useQueryClient();
  const mutationKey = orderWriteKey(owner, id);
  const pending = useIsMutating({ mutationKey, exact: true }) > 0;
  const mutation = useMutation({
    mutationKey,
    mutationFn: () => cancelOrder(owner, id),
    onSuccess: (order) => saveConfirmedOrder(cache, order),
  });
  return (
    <>
      <button
        type="button"
        className="button secondary"
        disabled={pending}
        onClick={() => {
          if (!cache.isMutating({ mutationKey, exact: true }))
            mutation.mutate();
        }}
      >
        {mutation.isPending ? "Скасовуємо…" : "Скасувати замовлення"}
      </button>
      {mutation.error && (
        <p className="error" role="alert">
          {orderError(mutation.error, "Не вдалося скасувати замовлення.")}
        </p>
      )}
    </>
  );
}
