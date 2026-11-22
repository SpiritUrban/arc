import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { paths } from "../paths.ts";
import { useSelectedUser, UsersPanel } from "../users/panel.tsx";
import { CancelOrder } from "./actions.tsx";
import { orderQuery } from "./api.ts";
import { money, OrderForm } from "./panel.tsx";

export function OrderDetail() {
  const { id = "" } = useParams<"id">();
  const owner = useSelectedUser();
  const query = useQuery({ ...orderQuery(owner, id), retry: false });
  const order = query.data;
  return (
    <section>
      <Link to={paths.orders}>← Усі замовлення</Link>
      <h1>Деталі замовлення</h1>
      <div className="content-grid">
        <UsersPanel />
        <section className="panel" aria-label="Замовлення">
          {query.isPending && <p role="status">Завантажуємо замовлення…</p>}
          {query.isError && (
            <p className="error" role="alert">
              Замовлення не знайдено або недоступне.
            </p>
          )}
          {order && (
            <>
              <h2>{order.product}</h2>
              <p>Кількість {order.quantity}</p>
              <p>Сума {money.format(order.total)}</p>
              <p>{order.cancelled ? "Скасовано" : "Створено"}</p>
              {!order.cancelled && (
                <>
                  <CancelOrder key={order.id} owner={owner} id={order.id} />
                  <OrderForm key={order.id} owner={owner} order={order} />
                </>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
}
