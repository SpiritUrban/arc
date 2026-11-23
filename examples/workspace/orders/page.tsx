// Браузерна частина замовлень. Зміна користувача оновлює список,
// а надсилання форми викликає серверну операцію створення.
import { derive, view, type Signal } from "@arc/framework/web";
import { ListOrders, CreateOrder, CancelOrder } from "./contracts.ts";
import { activeUser } from "../user-selection.ts";
import { orderClient } from "./client.ts";
import { OrderFields } from "./fields.tsx";
import { money, failureMessage } from "../ui.ts";

function renderOrdersPage(
  quantity: Signal<string>,
  search: Signal<string>,
  status: Signal<string>,
) {
  function filteredOrders() {
    const term = search().trim().toLowerCase();
    const selectedStatus = status();
    return visibleOrders().filter((order) =>
      (!term || order.product.toLowerCase().includes(term)) &&
      (selectedStatus === "all" || (selectedStatus === "cancelled") === order.cancelled),
    );
  }

  return (
    <section class="orders-panel">
      <div class="summary-grid">
        <div class="summary-card">
          <span class="muted">Замовлень користувача</span>
          <strong data-count>
            {String(visibleOrders().length).padStart(2, "0")}
          </strong>
          <span class="summary-note">У поточній сесії</span>
        </div>
        <div class="summary-card accent">
          <span>Загальна сума</span>
          <strong data-amount>
            {money(visibleOrders().reduce((sum, order) => sum + order.total, 0))}
          </strong>
          <span class="summary-note">25 ₴ за одиницю товару</span>
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
            {createOrder().running ? "Створюємо…" : <>Створити <span>→</span></>}
          </button>
        </form>
        <div class="form-footer">
          <span>
            Підсумок{" "}
            <strong data-preview>{money((Number(quantity()) || 0) * 25)}</strong>
          </span>
          <span>Для вибраного користувача</span>
        </div>
        <p class="error" role="alert" data-error>
          {failureMessage(
            (createOrder.invalid() ? undefined : createOrder().error) ??
              ordersData().error,
          )}
        </p>
      </div>
      <div class="panel history">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">ІСТОРІЯ</span>
            <h2 data-owner>
              {activeUser()
                ? `Замовлення · ${activeUser()!.name}`
                : "Оберіть користувача"}
            </h2>
          </div>
          <span
            class="muted"
            data-loading
            role="status"
          >{ordersData().loading ? "Завантажуємо замовлення…" : ""}</span>
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
              <option value="created">Створені</option>
              <option value="cancelled">Скасовані</option>
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
            <tbody data-rows>
              {filteredOrders().map((order) => (
                  <tr key={order.id} data-order={order.id}>
                    <td>
                      <strong><a href={`/orders/${order.id}`}>{order.product}</a></strong>
                      <small>#{order.id.slice(0, 8)}</small>
                    </td>
                    <td>{order.quantity}</td>
                    <td>{money(order.total)}</td>
                    <td>
                      <span class="order-status">
                        {order.cancelled ? "Скасовано" : "Створено"}
                      </span>
                      {!order.cancelled && (
                        <button
                          class="button secondary"
                          type="button"
                          data-cancel-order
                          disabled={cancelOrder.pending(order.id)}
                          onClick={() => cancelOrder.run({ id: order.id })}
                        >
                          {cancelOrder.pending(order.id) ? "Скасовуємо…" : "Скасувати"}
                        </button>
                      )}
                      <p class="error" role="alert" data-cancel-error>
                        {cancelOrder.failed("ORDER_ALREADY_CANCELLED", order.id)
                          ? "Це замовлення вже скасовано."
                          : cancelOrder.failed("ORDER_NOT_FOUND", order.id)
                            ? "Замовлення не знайдено."
                            : failureMessage(cancelOrder.outcome(order.id)?.error)}
                      </p>
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredOrders().length === 0 && !ordersData().loading && (
          <div class="empty order-empty" data-empty>
            <span class="empty-symbol">▤</span>
            <strong>
              {search().trim() || status() !== "all"
                ? "Замовлень не знайдено"
                : "Тут з’являться замовлення"}
            </strong>
            <p>
              {search().trim() || status() !== "all"
                ? "Змініть пошук або статус замовлення."
                : "Створіть перше замовлення для цього користувача."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

// Список і форма працюють від імені вибраного демо-користувача.
export const ordersData = orderClient.query(ListOrders, {
  cache: true,
});

// CreateOrder — спільний контракт. На сервері його реалізує маршрут createOrder у ./server.ts.
export const createOrder = orderClient.mutation(CreateOrder, {
  update: ordersData.insertBy("id"),
});

const cancelOrder = orderClient.mutation(CancelOrder, {
  key: ({ id }) => id,
  update: ordersData.replaceBy("id"),
  updateOnError: "ORDER_ALREADY_CANCELLED",
});

export const visibleOrders = derive({
  id: "orders.visible",
  from: ordersData.data,
  compute: (orders) => orders ?? [],
});

export const OrdersPage = view({
  id: "orders.page",
  needs: cancelOrder,
  state: { quantity: "1", search: "", status: "all" },
  template: ({ quantity, search, status }) => renderOrdersPage(quantity, search, status),
});
