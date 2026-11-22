import type { PageContext } from "@arc/framework/web";
import { CancelOrder, GetOrder, UpdateOrder } from "../../orders/contracts.ts";
import { orderClient } from "../../orders/client.ts";
import { ordersData } from "../../orders/page.tsx";
import { UsersPage } from "../../users/page.tsx";
import { money } from "../../ui.ts";

export const title = "Деталі замовлення — ARC Workspace";

export default function OrderDetail({ own, query }: PageContext<"id">) {
  const order = query(orderClient, GetOrder);
  const updateOrder = own(orderClient.mutation(UpdateOrder, {
    update: [order.replace(), ordersData.replaceBy("id")],
  }));
  const cancelOrder = own(orderClient.mutation(CancelOrder, {
    id: "orders.detail-cancel.submit",
    update: [order.replace(), ordersData.replaceBy("id")],
  }));

  return (
    <section>
      <a href="/orders">← Усі замовлення</a>
      <h1>Деталі замовлення</h1>
      <div class="content-grid">
        <div id="users"><UsersPage /></div>
        <section class="panel" aria-label="Замовлення">
          {order().loading && <p role="status">Завантажуємо замовлення…</p>}
          {order().error ? <p class="error" role="alert">Замовлення не знайдено або недоступне.</p> : null}
          {order().data && (
            <div data-order-detail>
              <h2>{order().data?.product}</h2>
              <p>Кількість {order().data?.quantity}</p>
              <p>Сума {money(order().data?.total ?? 0)}</p>
              <p>{order().data?.cancelled ? "Скасовано" : "Створено"}</p>
              {!order().data?.cancelled && (
                <button
                  class="button secondary"
                  type="button"
                  disabled={cancelOrder().running}
                  onClick={() => cancelOrder.run({ id: order().data!.id })}
                >
                  {cancelOrder().running ? "Скасовуємо…" : "Скасувати замовлення"}
                </button>
              )}
            </div>
          )}
          <p class="error" role="alert">
            {cancelOrder.failed("ORDER_ALREADY_CANCELLED")
              ? "Замовлення вже скасовано."
              : cancelOrder.failed("ORDER_NOT_FOUND")
                ? "Замовлення не знайдено."
                : cancelOrder().error
                  ? "Не вдалося скасувати замовлення."
                  : ""}
          </p>
          {order().data && !order().data.cancelled && (
            <form data-edit-order novalidate onSubmit={updateOrder}>
              <h2>Редагувати замовлення</h2>
              <input type="hidden" name="id" value={order().data.id} />
              <label>
                Товар
                <input
                  name="product"
                  required
                  maxlength="100"
                  value={order().data.product}
                  aria-invalid={updateOrder.invalid("product")}
                />
              </label>
              <p class="error" role="alert">
                {updateOrder.invalid("product") && "Вкажіть назву товару."}
              </p>
              <label>
                Кількість
                <input
                  name="quantity"
                  required
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={String(order().data.quantity)}
                  aria-invalid={updateOrder.invalid("quantity")}
                />
              </label>
              <p class="error" role="alert">
                {updateOrder.invalid("quantity") && "Введіть ціле число від 1 до 100."}
              </p>
              <button class="button primary" type="submit" disabled={updateOrder().running}>
                {updateOrder().running ? "Зберігаємо…" : "Зберегти зміни"}
              </button>
              <p class="error" role="alert">
                {updateOrder.failed("ORDER_ALREADY_CANCELLED")
                  ? "Скасоване замовлення не можна редагувати."
                  : updateOrder.failed("ORDER_NOT_FOUND")
                    ? "Замовлення не знайдено."
                    : updateOrder().error && !updateOrder.invalid()
                      ? "Не вдалося зберегти замовлення."
                      : ""}
              </p>
            </form>
          )}
        </section>
      </div>
    </section>
  );
}
