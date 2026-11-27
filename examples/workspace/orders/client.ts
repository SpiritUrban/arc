import { remoteApi } from "@arc/framework/fullstack";
import { state } from "@arc/framework/web";
import { selectedUser } from "../user-selection.ts";
import { CancelOrder, CreateOrder, ListOrders, compareOrderIds, matchesOrderStatus } from "./contracts.ts";
import type { orderStatuses } from "./messages.ts";

export const allStatuses = "all";
export const orderStatusFilter = state<keyof typeof orderStatuses | typeof allStatuses>({
  id: "orders.status-filter",
  initial: allStatuses,
});

export const orderClient = remoteApi({
  bearer: selectedUser,
  key: true,
});

export const ordersData = orderClient.query(ListOrders, { cache: true });
const historyClient = remoteApi({
  from: [selectedUser, orderStatusFilter],
  bearer: (owner) => owner,
  key: true,
});

export const ordersHistory = historyClient.query(ListOrders, {
  id: "orders.history",
  cache: true,
  enabled: (_owner, status) => status !== allStatuses,
  partition: (owner) => owner,
  input: (_owner, status) => status === allStatuses ? {} : { cancelled: status === "cancelled" },
});
const reconcileHistory = ordersHistory.reconcileBy("id", {
  includes: matchesOrderStatus,
  compare: compareOrderIds,
});

export const updateOrderLists = [ordersData.replaceBy(), reconcileHistory] as const;

export const createOrder = orderClient.mutation(CreateOrder, {
  update: [ordersData.insertBy(), reconcileHistory],
});

export const cancelListedOrder = orderClient.mutation(CancelOrder, {
  key: "id",
  update: updateOrderLists,
});
