import { remoteApi } from "@arc/framework/fullstack";
import type { PageContext } from "@arc/framework/web";
import { GetOrder } from "../../orders/contracts.ts";
import { selectedUser } from "../../user-selection.ts";
import { UsersPage } from "../../users/page.tsx";
import { money } from "../../ui.ts";

export const title = "Деталі замовлення — ARC Workspace";

const orderClient = remoteApi({
  from: [selectedUser],
  headers: (userId) => ({ authorization: `Bearer ${userId}` }),
});

export default function OrderDetail({ params, query }: PageContext<"id">) {
  const order = query(orderClient, GetOrder, {
    params,
    key: (userId) => userId,
  });

  return (
    <section>
      <a href="/orders">← Усі замовлення</a>
      <h1>Деталі замовлення</h1>
      <div class="content-grid">
        <div id="users">{UsersPage}</div>
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
        </section>
      </div>
    </section>
  );
}
