import type { PageContext } from "@arc/framework/web";
import { CancelOrder, GetOrder, UpdateOrder } from "../../orders/contracts.ts";
import { orderClient } from "../../orders/client.ts";
import { OrderFields } from "../../orders/fields.tsx";
import { ordersData } from "../../orders/page.tsx";
import { UsersPage } from "../../users/page.tsx";
import { money } from "../../ui.ts";

export const title = "Деталі замовлення — ARC Workspace";

export default function OrderDetail({ own, params, query }: PageContext<"id">) {
  const order = query(orderClient, GetOrder);
  const { data, loading, error } = order;
  const orderUpdates = [order.replace(), ordersData.replaceBy("id")];
  const updateOrder = own(orderClient.mutation(UpdateOrder, {
    params,
    update: orderUpdates,
  }));
  const cancelOrder = own(orderClient.mutation(CancelOrder, {
    id: "orders.detail-cancel.submit",
    params,
    update: orderUpdates,
    updateOnError: "ORDER_ALREADY_CANCELLED",
  }));

  function renderSummary(saved: ReturnType<typeof data>) {
    if (!saved) return null;
    return (
      <div data-order-detail>
        <h2>{saved.product}</h2>
        <p>Кількість {saved.quantity}</p>
        <p>Сума {money(saved.total)}</p>
        <p>{saved.cancelled ? "Скасовано" : "Створено"}</p>
        {!saved.cancelled && (
          <form onSubmit={cancelOrder}>
            <button class="button secondary" type="submit">
              {cancelOrder().running ? "Скасовуємо…" : "Скасувати замовлення"}
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <section>
      <a href="/orders">← Усі замовлення</a>
      <h1>Деталі замовлення</h1>
      <div class="content-grid">
        <div id="users"><UsersPage /></div>
        <section class="panel" aria-label="Замовлення">
          {loading() && <p role="status">Завантажуємо замовлення…</p>}
          {error() ? <p class="error" role="alert">Замовлення не знайдено або недоступне.</p> : null}
          {renderSummary(data())}
          <p class="error" role="alert">
            {cancelOrder.failed("ORDER_ALREADY_CANCELLED")
              ? "Замовлення вже скасовано."
              : cancelOrder.failed("ORDER_NOT_FOUND")
                ? "Замовлення не знайдено."
                : cancelOrder().error
                  ? "Не вдалося скасувати замовлення."
                  : ""}
          </p>
          {data()?.cancelled === false && (
            <form data-edit-order novalidate onSubmit={updateOrder}>
              <h2>Редагувати замовлення</h2>
              <OrderFields mutation={updateOrder} order={data} />
              <button class="button primary" type="submit">
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
