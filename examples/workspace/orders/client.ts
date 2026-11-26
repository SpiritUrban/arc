import { remoteApi } from "@arc/framework/fullstack";
import { selectedUser } from "../user-selection.ts";
import { CancelOrder, CreateOrder, ListOrders } from "./contracts.ts";

export const orderClient = remoteApi({
  bearer: selectedUser,
  key: true,
});

export const ordersData = orderClient.query(ListOrders, { cache: true });
export const replaceListedOrder = ordersData.replaceBy();

export const createOrder = orderClient.mutation(CreateOrder, {
  update: ordersData.insertBy(),
});

export const cancelListedOrder = orderClient.mutation(CancelOrder, {
  key: "id",
  update: replaceListedOrder,
});
