import { entityUpdates, remoteApi } from "@arc/framework/fullstack";
import { derive, state } from "@arc/framework/web";
import { selectedUser } from "../user-selection.ts";
import { CancelOrder, CreateOrder, ListOrderPage, ListOrders, compareOrderIds, matchesOrderStatus, type Order } from "./contracts.ts";
import type { orderStatuses } from "./messages.ts";

export const allStatuses = "all";
export const orderStatusFilter = state<keyof typeof orderStatuses | typeof allStatuses>({
  id: "orders.status-filter",
  initial: allStatuses,
});
export const orderSearch = state({ id: "orders.search", initial: "" });
export const orderSearchTerm = derive("orders.search-term", orderSearch, (search) => search.trim().toLowerCase());
export const paginatedOrders = state({ id: "orders.paginated", initial: false });
export const orderPageSize = 5;

const pageSelection = state({ id: "orders.page-selection", initial: { scope: "", index: 0 } });
const pageScope = derive("orders.page-scope", [selectedUser, orderStatusFilter, orderSearchTerm],
  (owner, status, term) => JSON.stringify([owner, status, term]));
export const orderPageIndex = derive("orders.page-index", [pageScope, pageSelection],
  (scope, selection) => scope === selection.scope ? selection.index : 0);

export function moveOrderPage(step: -1 | 1) {
  pageSelection.set({ scope: pageScope(), index: Math.max(0, orderPageIndex() + step) });
}

function orderStatusInput(status: ReturnType<typeof orderStatusFilter>) {
  return status === allStatuses ? {} : { cancelled: status === "cancelled" };
}

export const orderClient = remoteApi({
  bearer: selectedUser,
  key: true,
});
export const orderUpdates = entityUpdates<Order>({
  key: (order) => [order.userId, order.id],
  revision: (order) => order.revision,
});

export const ordersData = remoteApi({
  from: [selectedUser, paginatedOrders],
  bearer: (owner) => owner,
}).query(ListOrders, {
  cache: true,
  enabled: (_owner, paginated) => !paginated,
  key: (owner) => owner,
});
const historyClient = remoteApi({
  from: [selectedUser, orderStatusFilter, paginatedOrders],
  bearer: (owner) => owner,
  key: true,
});

export const ordersHistory = historyClient.query(ListOrders, {
  id: "orders.history",
  cache: true,
  enabled: (_owner, status, paginated) => status !== allStatuses && !paginated,
  partition: (owner) => owner,
  input: (_owner, status) => orderStatusInput(status),
});
const reconcileHistory = ordersHistory.reconcileBy("id", {
  includes: matchesOrderStatus,
  compare: compareOrderIds,
});

const pageRequest = derive("orders.page-request",
  [selectedUser, orderStatusFilter, orderSearchTerm, orderPageIndex, paginatedOrders],
  (owner, status, term, index, enabled) => ({
    owner,
    enabled,
    input: { ...orderStatusInput(status), product: term, offset: index * orderPageSize, limit: orderPageSize },
  }));

export const ordersPageData = remoteApi({
  from: pageRequest,
  bearer: ({ owner }) => owner,
}).query(ListOrderPage, {
  id: "orders.history.page",
  cache: true,
  enabled: ({ enabled }) => enabled,
  partition: ({ owner }) => owner,
  input: ({ input }) => input,
});
const revalidateHistoryPage = ordersPageData.revalidatePartition();
const updateHistories = [reconcileHistory, revalidateHistoryPage] as const;
export const updateOrderLists = [ordersData.replaceBy(), ...updateHistories] as const;

export const createOrder = orderClient.mutation(CreateOrder, {
  entity: orderUpdates,
  update: [ordersData.insertBy(), ...updateHistories],
});

export const cancelListedOrder = orderClient.mutation(CancelOrder, {
  entity: orderUpdates,
  key: "id",
  update: updateOrderLists,
});
