import type { PageContext } from "@arc/framework/web";
import { GetOrder, UpdateOrder } from "../../orders/contracts.ts";
import { orderClient } from "../../orders/client.ts";
import { UsersPage } from "../../users/page.tsx";
import { money } from "../../ui.ts";

export const title = "Деталі замовлення — ARC Workspace";

export default function OrderDetail({ query }: PageContext<"id">) {
  const order = query(orderClient, GetOrder);
  const updateOrder = orderClient.mutation(UpdateOrder, {
    update: order.replace(),
  });

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
            </div>
          )}
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
