import { remoteApi, type Mutation, type RemoteResource } from "@arc/framework/fullstack";
import { batch, currentWriteTrace, withWriteTrace } from "@arc/framework/web";
import { selectedUser } from "../user-selection.ts";
import type { CancelOrder, GetOrder } from "./contracts.ts";

export const orderClient = remoteApi({
  from: selectedUser,
  key: (userId) => userId,
  headers: (userId) => ({ authorization: `Bearer ${userId}` }),
});

type OrderUpdate = ReturnType<RemoteResource<typeof GetOrder>["replace"]>;

export async function cancelAndReconcile(
  mutation: Pick<Mutation<typeof CancelOrder>, "run">,
  id: string,
  updates: readonly OrderUpdate[],
) {
  // Capture the original owner key before the response arrives.
  const apply = updates.map((update) => update.capture());
  const trace = currentWriteTrace() ?? { traceId: crypto.randomUUID() };
  const result = await withWriteTrace(trace, () => mutation.run({ id }));
  if (result.kind === "business_error" && result.error === "ORDER_ALREADY_CANCELLED")
    batch(() => {
      for (const update of apply) update(result.details, trace);
    });
}
