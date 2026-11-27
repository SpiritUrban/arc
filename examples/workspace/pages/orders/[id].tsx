import type { RouteParamNames } from "@arc/framework/core";
import { render, type PageContext } from "@arc/framework/web";
import { CancelOrder, GetOrder, UpdateOrder, isOrderActive, type Order } from "../../orders/contracts.ts";
import { orderClient, orderUpdates, updateOrderLists } from "../../orders/client.ts";
import { OrderFields } from "../../orders/fields.tsx";
import { orderStatusLabel, orderWriteMessage } from "../../orders/messages.ts";
import { orderDetailPattern, ordersPath } from "../../orders/paths.ts";
import { UsersPage } from "../../users/page.tsx";
import { editFormOptions, money } from "../../ui.ts";

export const title = "Деталі замовлення — ARC Workspace";

export default function OrderDetail({ bind }: PageContext<RouteParamNames<typeof orderDetailPattern>>) {
  const { query, mutation } = bind(orderClient);
  const order = query(GetOrder);
  const update = [order, ...updateOrderLists];
  const entity = orderUpdates;
  const updateOrder = mutation(UpdateOrder, { ...editFormOptions, entity, update });
  const cancelOrder = mutation(CancelOrder, { entity, update });

  function renderSummary(saved: Order) {
    return (
      <div data-order-detail>
        <h2>{saved.product}</h2>
        <p>Кількість {saved.quantity}</p>
        <p>Сума {money(saved.total)}</p>
        <p>{orderStatusLabel(saved)}</p>
        {isOrderActive(saved) && (
          <form onSubmit={cancelOrder}>
            <button class="button secondary" type="submit">
              {render.when(cancelOrder.running, "Скасовуємо…", "Скасувати замовлення")}
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <section>
      <a href={ordersPath}>← Усі замовлення</a>
      <h1>Деталі замовлення</h1>
      <div class="content-grid">
        <UsersPage />
        <section class="panel" aria-label="Замовлення">
          {render.when(order.loading, <p role="status">Завантажуємо замовлення…</p>)}
          {render.present(order.error,
            <p class="error" role="alert">Замовлення не знайдено або недоступне.</p>,
          )}
          {render.present(order.data, renderSummary)}
          <p class="error" role="alert">
            {orderWriteMessage(cancelOrder(), "cancel")}
          </p>
          {isOrderActive(order.data()) && (
            <form data-edit-order novalidate onSubmit={updateOrder}>
              <h2>Редагувати замовлення</h2>
              <OrderFields mutation={updateOrder} savedValues={order.data} />
              <button class="button primary" type="submit">
                {render.when(updateOrder.running, "Зберігаємо…", "Зберегти зміни")}
              </button>
            </form>
          )}
          <p class="error" role="alert" data-edit-order-error>
            {order.data() && !updateOrder.invalid() ? orderWriteMessage(updateOrder(), "update") : ""}
          </p>
        </section>
      </div>
    </section>
  );
}
