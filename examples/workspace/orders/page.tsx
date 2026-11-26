// Браузерна частина замовлень. Зміна користувача оновлює список,
// а надсилання форми викликає серверну операцію створення.
import { each, render, view } from "@arc/framework/web";
import { orderTotal, orderUnitPrice, quantityLimits, type Order } from "./contracts.ts";
import { activeUser } from "../user-selection.ts";
import { cancelListedOrder, createOrder, ordersData } from "./client.ts";
import { OrderFields } from "./fields.tsx";
import { orderStatus, orderStatuses, orderWriteMessage } from "./messages.ts";
import { money, failureMessage } from "../ui.ts";

function CancelOrderControl({ order: { id, cancelled } }: { order: ReturnType<typeof Order.parse> }) {
  const cancel = cancelListedOrder.for(id);
  return (
    <>
      {!cancelled && (
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
        {orderWriteMessage(cancel.outcome(), "Це замовлення вже скасовано.")}
      </p>
    </>
  );
}

const visibleOrders = ordersData.dataOr([], "visible");
const orderSummary = ordersData.select("summary", (orders) => ({
  count: orders?.length ?? 0,
  total: orders?.reduce((sum, order) => sum + order.total, 0) ?? 0,
}));

export const OrdersPage = view({
  id: "orders.page",
  state: { quantity: String(quantityLimits.min), search: "", status: "all" },
  template({ quantity, search, status }, { derive }) {
    const searchTerm = derive([search], (search) => search.trim().toLowerCase());
    const history = derive([visibleOrders, searchTerm, status], (orders, term, status) =>
      orders.filter((order) =>
        order.product.toLowerCase().includes(term) &&
        (status === "all" || orderStatus(order) === status),
      ),
    );
    const emptyHistory = derive(
      [history, ordersData.loading, searchTerm, status],
      (orders, loading, term, status) => {
        if (loading || orders.length > 0) return undefined;
        return term !== "" || status !== "all"
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
              {String(orderSummary().count).padStart(2, "0")}
            </strong>
            <span class="summary-note">У поточній сесії</span>
          </div>
          <div class="summary-card accent">
            <span>Загальна сума</span>
            <strong data-amount>
              {money(orderSummary().total)}
            </strong>
            <span class="summary-note">{orderUnitPrice} ₴ за одиницю товару</span>
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
                ordersData.error(),
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
            >{render.when(ordersData.loading, "Завантажуємо замовлення…")}</span>
          </div>
          <div class="order-filters">
            <label class="search-label">
              <span>Пошук товару</span>
              <input
                data-order-search
                type="search"
                placeholder="Назва товару"
                bind:value={search}
              />
            </label>
            <label>
              Статус
              <select data-order-status bind:value={status}>
                <option value="all">Усі замовлення</option>
                {Object.entries(orderStatuses).map(([value, { filterLabel }]) => (
                  <option value={value}>{filterLabel}</option>
                ))}
              </select>
            </label>
          </div>
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
              <tbody data-rows aria-busy={ordersData.loading}>
                {each(history, {
                  needs: cancelListedOrder,
                  render: (order) => (
                    <tr data-order={order.id}>
                      <td>
                        <strong><a href={`/orders/${order.id}`}>{order.product}</a></strong>
                        <small>#{order.id.slice(0, 8)}</small>
                      </td>
                      <td>{order.quantity}</td>
                      <td>{money(order.total)}</td>
                      <td>
                        <span class="order-status">
                          {orderStatuses[orderStatus(order)].label}
                        </span>
                        <CancelOrderControl order={order} />
                      </td>
                    </tr>
                  ),
                })}
              </tbody>
            </table>
          </div>
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
