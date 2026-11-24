import { ValidationError } from "@arc/framework/core";
import type { PageContext } from "@arc/framework/web";
import { CancelOrder, GetOrder, UpdateOrder } from "../../orders/contracts.ts";
import { orderClient } from "../../orders/client.ts";
import { OrderFields } from "../../orders/fields.tsx";
import { orderWriteMessage } from "../../orders/messages.ts";
import { ordersData } from "../../orders/page.tsx";
import { UsersPage } from "../../users/page.tsx";
import { money } from "../../ui.ts";

export const title = "Деталі замовлення — ARC Workspace";

export default function OrderDetail({ bind }: PageContext<"id">) {
  const { query, mutation } = bind(orderClient);
  const order = query(GetOrder);
  const update = [order.replace(), ordersData.replaceBy("id")];
  const updateOrder = mutation(UpdateOrder, { update });
  const cancelOrder = mutation(CancelOrder, {
    id: "orders.detail-cancel.submit",
    update,
    updateOnError: "ORDER_ALREADY_CANCELLED",
  });

  function renderSummary(saved: ReturnType<typeof order.data>) {
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
              {cancelOrder.running() ? "Скасовуємо…" : "Скасувати замовлення"}
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
        <UsersPage />
        <section class="panel" aria-label="Замовлення">
          {order.loading() && <p role="status">Завантажуємо замовлення…</p>}
          {order.error() ? <p class="error" role="alert">Замовлення не знайдено або недоступне.</p> : null}
          {renderSummary(order.data())}
          <p class="error" role="alert">
            {orderWriteMessage(cancelOrder(), "Замовлення вже скасовано.",
              () => "Не вдалося скасувати замовлення.",
            )}
          </p>
          {order.data()?.cancelled === false && (
            <form data-edit-order novalidate onSubmit={updateOrder}>
              <h2>Редагувати замовлення</h2>
              <OrderFields mutation={updateOrder} order={order.data} />
              <button class="button primary" type="submit">
                {updateOrder.running() ? "Зберігаємо…" : "Зберегти зміни"}
              </button>
              <p class="error" role="alert">
                {orderWriteMessage(updateOrder(), "Скасоване замовлення не можна редагувати.",
                  (error) => error instanceof ValidationError ? "" : "Не вдалося зберегти замовлення.",
                )}
              </p>
            </form>
          )}
        </section>
      </div>
    </section>
  );
}
