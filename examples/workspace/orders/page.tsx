// Браузерна частина замовлень. Зміна користувача оновлює список,
// а надсилання форми викликає серверну операцію створення.
import { derive, each, project, view } from "@arc/framework/web";
import { integerField, remoteApi, textField } from "@arc/framework/fullstack";
import { ListOrders, CreateOrder } from "./contracts.ts";
import { selectedUser, activeUser } from "../user-selection.ts";
import { money, failureMessage } from "../ui.ts";

function renderOrdersPage() {
  return (
    <section class="orders-panel">
      <div class="summary-grid">
        <div class="summary-card">
          <span class="muted">Замовлень користувача</span>
          <strong data-count>
            {project(visibleOrders, (orders) =>
              String(orders.length).padStart(2, "0"),
            )}
          </strong>
          <span class="summary-note">У поточній сесії</span>
        </div>
        <div class="summary-card accent">
          <span>Загальна сума</span>
          <strong data-amount>
            {project(visibleOrders, (orders) =>
              money(orders.reduce((sum, order) => sum + order.total, 0)),
            )}
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
        <form class="order-form" data-form on:submit={createOrder}>
          <label class="product-field">
            Назва товару
            <input
              data-product
              required
              maxlength="100"
              placeholder="Наприклад, блокнот ARC"
              bind:value={orderFields.product}
            />
          </label>
          <label class="quantity-field">
            Кількість
            <input
              data-quantity
              required
              type="number"
              min="1"
              max="100"
              step="1"
              bind:value={orderFields.quantity}
            />
          </label>
          <button
            class="button primary"
            type="submit"
            bind:disabled={createOrder.running}
          >
            Створити <span>→</span>
          </button>
        </form>
        <div class="form-footer">
          <span>
            Підсумок{" "}
            <strong data-preview bind:text={formFeedback.preview}></strong>
          </span>
          <span>Для вибраного користувача</span>
        </div>
        <p
          class="error"
          role="alert"
          data-error
          bind:text={formFeedback.error}
        ></p>
      </div>
      <div class="panel history">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">ІСТОРІЯ</span>
            <h2 data-owner bind:text={history.title}></h2>
          </div>
          <span
            class="muted"
            data-loading
            role="status"
            bind:text={history.loading}
          ></span>
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
              {each(visibleOrders, {
                key: (order) => order.id,
                render: (order) => (
                  <tr>
                    <td>
                      <strong>{order.product}</strong>
                      <small>#{order.id.slice(0, 8)}</small>
                    </td>
                    <td>{order.quantity}</td>
                    <td>{money(order.total)}</td>
                    <td>
                      <span class="order-status">Створено</span>
                    </td>
                  </tr>
                ),
              })}
            </tbody>
          </table>
        </div>
        <div class="empty order-empty" data-empty bind:visible={history.empty}>
          <span class="empty-symbol">▤</span>
          <strong>Тут з’являться замовлення</strong>
          <p>Створіть перше замовлення для цього користувача.</p>
        </div>
      </div>
    </section>
  );
}

// Список і форма працюють від імені вибраного демо-користувача.
const orderClient = remoteApi({
  from: [selectedUser],
  headers: (userId) => ({ authorization: `Bearer ${userId}` }),
});

export const ordersData = orderClient.query(ListOrders);

// CreateOrder — спільний контракт. На сервері його реалізує маршрут createOrder у ./server.ts.
const { fields: orderFields, submit: createOrder } = orderClient.form(
  CreateOrder,
  {
    fields: {
      product: textField(),
      quantity: integerField(1),
    },
    refresh: [ordersData],
  },
);
export { createOrder };

// Поки новий список завантажується, фільтр приховує кешовані замовлення попереднього користувача.
export const visibleOrders = derive({
  id: "orders.visible",
  from: [ordersData.data, selectedUser],
  compute: (orders, id) => (orders ?? []).filter((o) => o.userId === id),
});

const formFeedback = {
  preview: derive({
    id: "orders.preview",
    from: [orderFields.quantity],
    compute: (q) => money((Number(q) || 0) * 25),
  }),
  error: derive({
    id: "orders.errors",
    from: [createOrder.error, ordersData.error],
    compute: (createError, loadError) =>
      failureMessage(createError ?? loadError),
  }),
};

const history = {
  title: derive({
    id: "orders.user-label",
    from: [activeUser],
    compute: (user) =>
      user ? `Замовлення · ${user.name}` : "Оберіть користувача",
  }),
  loading: derive({
    id: "orders.loading",
    from: [ordersData.loading],
    compute: (loading) => (loading ? "Завантажуємо замовлення…" : ""),
  }),
  empty: derive({
    id: "orders.empty",
    from: [visibleOrders, ordersData.loading],
    compute: (orders, loading) => orders.length === 0 && !loading,
  }),
};

export const OrdersPage = view({
  id: "orders.page",
  template: renderOrdersPage,
});
