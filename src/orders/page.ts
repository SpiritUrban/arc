import { state, derive, action, binding, view } from "@arc/framework/web";
import { remote, remoteClient } from "@arc/framework/fullstack";
import { ListOrders, CreateOrder } from "./contracts.ts";
import { selectedUser, activeUser } from "../users/page.ts";
import { escapeHTML, money, failureMessage, inputBindings } from "../ui.ts";
// Demo authorization matches the existing request-scoped currentUser capability.
// The header is read per request, so changing user cannot reuse a previous identity.
const authenticatedFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${selectedUser.get()}`);
  return globalThis.fetch(input, { ...init, headers });
};
export const ordersData = remote(ListOrders, {
  id: "orders.current",
  from: [selectedUser],
  input: () => ({}),
  fetch: authenticatedFetch,
});
const product = state({ id: "orders.new-product", initial: "" });
const quantity = state({ id: "orders.new-quantity", initial: "1" });
const create = remoteClient(CreateOrder, {
  id: "orders.create.remote",
  fetch: authenticatedFetch,
});
export const addOrder = action({
  id: "orders.add",
  needs: { product, quantity, selectedUser, create },
  invalidates: [ordersData],
  async run(_, ctx) {
    const result = await create.call(
      { product: product.get().trim(), quantity: Number(quantity.get()) },
      ctx,
    );
    if (result.ok) {
      ctx.set(product, "");
      ctx.set(quantity, "1");
    }
    return result;
  },
});
// Hide a previous user's cached projection while the next identity is loading.
export const visibleOrders = derive({
  id: "orders.visible",
  from: [ordersData.data, selectedUser],
  compute: (orders, id) => (orders ?? []).filter((o) => o.userId === id),
});
const total = derive({
  id: "orders.total",
  from: [visibleOrders],
  compute: (orders) => orders.reduce((sum, o) => sum + o.total, 0),
});
const productFields = inputBindings("orders.product", product),
  quantityFields = inputBindings("orders.quantity", quantity);
const submit = binding({
  id: "orders.submit",
  type: "event",
  name: "submit",
  sources: [],
  handler(event, trace) {
    event.preventDefault();
    if (!addOrder.running.get()) return addOrder.execute(undefined, { trace });
  },
});
submit.dependencies = [...(submit.dependencies ?? []), addOrder];
submit.relations = [
  ...(submit.relations ?? []),
  { to: addOrder, kind: "TRIGGERS" },
];
const disabled = binding({
  id: "orders.submit.disabled",
  type: "property",
  name: "disabled",
  sources: [addOrder.running],
});
const userLabel = binding({
  id: "orders.user-label",
  type: "text",
  sources: [activeUser],
  format: (user) =>
    user ? `Замовлення · ${user.name}` : "Оберіть користувача",
});
const rows = binding({
  id: "orders.table.rows",
  type: "property",
  name: "innerHTML",
  sources: [visibleOrders],
  format: (orders) =>
    orders
      .map(
        (order: any) =>
          `<tr><td><strong>${escapeHTML(order.product)}</strong><small>#${escapeHTML(order.id.slice(0, 8))}</small></td><td>${order.quantity}</td><td>${escapeHTML(money(order.total))}</td><td><span class="order-status">Створено</span></td></tr>`,
      )
      .join(""),
});
const empty = binding({
  id: "orders.empty",
  type: "visible",
  sources: [visibleOrders, ordersData.loading],
  format: (orders, loading) => orders.length === 0 && !loading,
});
const loading = binding({
  id: "orders.loading",
  type: "text",
  sources: [ordersData.loading],
  format: (loading) => (loading ? "Завантажуємо замовлення…" : ""),
});
const errors = binding({
  id: "orders.errors",
  type: "text",
  sources: [addOrder.error, ordersData.error],
  format: (a, b) => failureMessage(a ?? b),
});
const count = binding({
  id: "orders.count",
  type: "text",
  sources: [visibleOrders],
  format: (orders) => String(orders.length).padStart(2, "0"),
});
const amount = binding({
  id: "orders.amount",
  type: "text",
  sources: [total],
  format: money,
});
const preview = binding({
  id: "orders.preview",
  type: "text",
  sources: [quantity],
  format: (q) => money((Number(q) || 0) * 25),
});
export const OrdersPage = view({
  id: "orders.page",
  bindings: [
    ...productFields,
    ...quantityFields,
    submit,
    disabled,
    userLabel,
    rows,
    empty,
    loading,
    errors,
    count,
    amount,
    preview,
  ],
  setup({ document, bind }) {
    const section = document.createElement("section");
    section.className = "orders-panel";
    section.innerHTML = `<div class="summary-grid"><div class="summary-card"><span class="muted">Замовлень користувача</span><strong data-count>00</strong><span class="summary-note">У поточній сесії</span></div><div class="summary-card accent"><span>Загальна сума</span><strong data-amount></strong><span class="summary-note">25 ₴ за одиницю товару</span></div></div><div class="panel"><div class="panel-heading"><div><span class="eyebrow">НОВЕ ЗАМОВЛЕННЯ</span><h2>Що додамо сьогодні?</h2></div><span class="circle-icon">↗</span></div><form class="order-form" data-form><label class="product-field">Назва товару<input data-product required maxlength="100" placeholder="Наприклад, блокнот ARC" /></label><label class="quantity-field">Кількість<input data-quantity required type="number" min="1" max="100" step="1" /></label><button class="button primary" type="submit">Створити <span>→</span></button></form><div class="form-footer"><span>Підсумок <strong data-preview></strong></span><span>Для вибраного користувача</span></div><p class="error" role="alert" data-error></p></div><div class="panel history"><div class="panel-heading"><div><span class="eyebrow">ІСТОРІЯ</span><h2 data-owner></h2></div><span class="muted" data-loading role="status"></span></div><div class="table-scroll"><table><thead><tr><th>Товар</th><th>Кількість</th><th>Сума</th><th>Статус</th></tr></thead><tbody data-rows></tbody></table></div><div class="empty order-empty" data-empty><span class="empty-symbol">▤</span><strong>Тут з’являться замовлення</strong><p>Створіть перше замовлення для цього користувача.</p></div></div>`;
    const at = (s: string) => section.querySelector(s)!;
    for (const b of productFields) bind(b, at("[data-product]"));
    for (const b of quantityFields) bind(b, at("[data-quantity]"));
    for (const [b, selector] of [
      [submit, "[data-form]"],
      [disabled, "button[type=submit]"],
      [userLabel, "[data-owner]"],
      [rows, "[data-rows]"],
      [empty, "[data-empty]"],
      [loading, "[data-loading]"],
      [errors, "[data-error]"],
      [count, "[data-count]"],
      [amount, "[data-amount]"],
      [preview, "[data-preview]"],
    ] as const)
      bind(b, at(selector));
    return section;
  },
});
