// Браузерна частина замовлень. Зміна користувача оновлює список,
// а надсилання форми викликає серверну операцію створення.
import { each, render, view } from "@arc/framework/web";
import { isOrderActive, orderTotal, orderUnitPrice, quantityLimits, type Order } from "./contracts.ts";
import { activeUser } from "../user-selection.ts";
import {
  allStatuses, cancelListedOrder, createOrder, moveOrderPage, orderPageIndex, orderPageSize,
  orderSearch, orderSearchTerm, ordersData, ordersHistory, ordersPageData, orderStatusFilter, paginatedOrders,
} from "./client.ts";
import { OrderFields } from "./fields.tsx";
import { orderStatuses, orderStatusLabel, orderWriteMessage } from "./messages.ts";
import { orderDetailPath } from "./paths.ts";
import { money, failureMessage } from "../ui.ts";

function CancelOrderControl({ order }: { order: Order }) {
  const cancel = cancelListedOrder.for(order.id);
  return (
    <>
      {isOrderActive(order) && (
        <button
          class="button secondary"
          type="button"
          data-cancel-order
          {...cancel.buttonProps}
        >
          {render.when(cancel.pending, "Скасовуємо…", "Скасувати")}
        </button>
      )}
      <p class="error" role="alert" data-cancel-error>
        {orderWriteMessage(cancel.outcome(), "cancel")}
      </p>
    </>
  );
}

const visibleOrders = ordersData.dataOr([], "visible");
const filteredOrders = ordersHistory.dataOr([], "visible");
const listSummary = ordersData.select("summary", (orders) => ({
  count: orders?.length ?? 0,
  total: orders?.reduce((sum, order) => sum + order.total, 0) ?? 0,
}));

export const OrdersPage = view({
  id: "orders.page",
  state: { quantity: String(quantityLimits.min) },
  template({ quantity }, { derive }) {
    const orderSummary = derive([listSummary, ordersPageData.data, paginatedOrders],
      (list, page, paginated) => paginated ? page?.summary : list);
    const history = derive(
      [visibleOrders, filteredOrders, ordersPageData.data, orderSearchTerm, orderStatusFilter, paginatedOrders],
      (all, filtered, page, term, status, paginated) => paginated
        ? page?.rows ?? []
        : (status === allStatuses ? all : filtered).filter((order) =>
          order.product.toLowerCase().includes(term)),
    );
    const loading = derive(
      [ordersData.loading, ordersHistory.loading, ordersPageData.loading, orderStatusFilter, paginatedOrders],
      (all, filtered, page, status, paginated) => paginated ? page : status === allStatuses ? all : filtered,
    );
    const emptyHistory = derive(
      [history, loading, orderSearchTerm, orderStatusFilter, paginatedOrders, orderPageIndex],
      (orders, loading, term, status, paginated, index) => {
        if (loading || orders.length > 0) return undefined;
        if (paginated && index > 0)
          return { title: "Сторінка порожня", description: "Поверніться на попередню сторінку." };
        return term !== "" || status !== allStatuses
          ? {
              title: "Замовлень не знайдено",
              description: "Змініть пошук або статус замовлення.",
            }
          : {
              title: "Тут з’являться замовлення",
              description: "Створіть перше замовлення для цього користувача.",
            };
      },
    );

    return (
      <section id="orders" class="orders-panel">
        <div class="summary-grid">
          <div class="summary-card">
            <span class="muted">Замовлень користувача</span>
            <strong data-count>
              {String(orderSummary()?.count ?? 0).padStart(2, "0")}
            </strong>
            <span class="summary-note">У поточній сесії</span>
          </div>
          <div class="summary-card accent">
            <span>Загальна сума</span>
            <strong data-amount>
              {money(orderSummary()?.total ?? 0)}
            </strong>
            <span class="summary-note">{money(orderUnitPrice)} за одиницю товару</span>
          </div>
        </div>
        <div class="panel">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">НОВЕ ЗАМОВЛЕННЯ</span>
              <h2>Що додамо сьогодні?</h2>
            </div>
            <span class="circle-icon">↗</span>
          </div>
          {/* ARC перехоплює submit, викликає createOrder і залишає користувача на цій сторінці. */}
          <form class="order-form" data-form novalidate onSubmit={createOrder}>
            <OrderFields mutation={createOrder} quantity={quantity} />
            <button class="button primary" type="submit">
              {render.when(createOrder.running, "Створюємо…", <>Створити <span>→</span></>)}
            </button>
          </form>
          <div class="form-footer">
            <span>
              Підсумок{" "}
              <strong data-preview>{money(orderTotal(Number(quantity()) || 0))}</strong>
            </span>
            <span>Для вибраного користувача</span>
          </div>
          <p class="error" role="alert" data-error>
            {failureMessage(
              (createOrder.invalid() ? undefined : createOrder.error()) ??
                ordersData.error() ?? (paginatedOrders() ? ordersPageData.error() : ordersHistory.error()),
            )}
          </p>
        </div>
        <div class="panel history">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">ІСТОРІЯ</span>
              <h2 data-owner>
                {render.present(activeUser, (user) => `Замовлення · ${user.name}`, "Оберіть користувача")}
              </h2>
            </div>
            <span
              class="muted"
              data-loading
              role="status"
            >{render.when(loading, "Завантажуємо замовлення…")}</span>
          </div>
          <div class="order-filters">
            <label class="search-label">
              <span>Пошук товару</span>
              <input
                data-order-search
                type="search"
                placeholder="Назва товару"
                bind:value={orderSearch}
              />
            </label>
            <label>
              Статус
              <select data-order-status bind:value={orderStatusFilter}>
                <option value={allStatuses}>Усі замовлення</option>
                {Object.entries(orderStatuses).map(([value, { filterLabel }]) => (
                  <option value={value}>{filterLabel}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <input type="checkbox" bind:checked={paginatedOrders} />
            Показувати по {orderPageSize} замовлень
          </label>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>Кількість</th>
                  <th>Сума</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody data-rows aria-busy={loading}>
                {each(history, {
                  needs: cancelListedOrder,
                  render: (order) => (
                    <tr data-order={order.id}>
                      <td>
                        <strong><a href={orderDetailPath(order.id)}>{order.product}</a></strong>
                        <small>#{order.id.slice(0, 8)}</small>
                      </td>
                      <td>{order.quantity}</td>
                      <td>{money(order.total)}</td>
                      <td>
                        <span class="order-status">
                          {orderStatusLabel(order)}
                        </span>
                        <CancelOrderControl order={order} />
                      </td>
                    </tr>
                  ),
                })}
              </tbody>
            </table>
          </div>
          {render.when(paginatedOrders, (
            <nav class="order-pages" aria-label="Сторінки замовлень">
              <button class="button secondary" type="button" disabled={orderPageIndex() === 0}
                onClick={() => moveOrderPage(-1)}>Попередня</button>
              <span>Сторінка {orderPageIndex() + 1}</span>
              <button class="button secondary" type="button" disabled={loading() || !ordersPageData.data()?.hasNext}
                onClick={() => moveOrderPage(1)}>Наступна</button>
            </nav>
          ))}
          {render.present(emptyHistory, ({ title, description }) => (
            <div class="empty order-empty" data-empty>
              <span class="empty-symbol">▤</span>
              <strong>{title}</strong>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </section>
    );
  },
});
