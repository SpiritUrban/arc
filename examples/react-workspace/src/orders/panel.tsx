import { useState, type FormEvent } from "react";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { generatePath, Link } from "react-router";
import { paths } from "../paths.ts";
import { ApiError } from "../http.ts";
import { useSelectedUser, useUsers } from "../users/panel.tsx";
import { CancelOrder, orderError, orderWriteKey } from "./actions.tsx";
import {
  createOrder,
  ordersKey,
  ordersQuery,
  saveConfirmedOrder,
  updateOrder,
} from "./api.ts";
import { orderHistory } from "./history.ts";
import {
  orderInputSchema,
  orderUnitPrice,
  type OrderInput,
  type Order,
} from "./contracts.ts";

export const money = new Intl.NumberFormat("uk-UA", {
  style: "currency",
  currency: "UAH",
  maximumFractionDigits: 0,
});

export function OrderForm({ owner, order }: { owner: string; order?: Order }) {
  const label = order ? "Редагувати замовлення" : "Створити замовлення";
  const [product, setProduct] = useState(order?.product ?? "");
  const [quantity, setQuantity] = useState(String(order?.quantity ?? 1));
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const cache = useQueryClient();
  const mutationKey = order
    ? orderWriteKey(owner, order.id)
    : ["orders.create", owner];
  const pending = useIsMutating({ mutationKey, exact: true }) > 0;
  const mutation = useMutation({
    mutationKey,
    mutationFn: (input: OrderInput) =>
      order ? updateOrder(owner, order.id, input) : createOrder(owner, input),
    onSuccess: (saved) =>
      order
        ? saveConfirmedOrder(cache, saved)
        : cache.invalidateQueries({ queryKey: ordersKey(owner) }),
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cache.isMutating({ mutationKey, exact: true })) return;
    mutation.reset();
    const parsed = orderInputSchema.safeParse({
      product,
      quantity: Number(quantity),
    });
    if (!parsed.success) {
      setInvalidFields(parsed.error.issues.map(({ path }) => String(path[0])));
      return;
    }
    setInvalidFields([]);
    try {
      const saved = await mutation.mutateAsync(parsed.data);
      setProduct((current) =>
        current === product ? (order ? saved.product : "") : current,
      );
      setQuantity((current) =>
        current === quantity ? (order ? String(saved.quantity) : "1") : current,
      );
    } catch {
      // TanStack Query keeps the error for the form.
    }
  }

  const error = mutation.error;
  const serverFields = error instanceof ApiError ? error.fields : [];
  const invalid = (name: string) =>
    invalidFields.includes(name) || serverFields.includes(name);
  return (
    <section className="panel">
      <h2>{label}</h2>
      <form
        className="order-form"
        aria-label={label}
        noValidate
        onSubmit={submit}
      >
        <div className="product-field">
          <label>
            Назва товару
            <input
              name="product"
              required
              maxLength={100}
              value={product}
              placeholder="Наприклад, блокнот ARC"
              aria-invalid={invalid("product")}
              onChange={(event) => setProduct(event.target.value)}
            />
          </label>
          {invalid("product") && (
            <p className="error" role="alert">
              Вкажіть назву товару.
            </p>
          )}
        </div>
        <div className="quantity-field">
          <label>
            Кількість
            <input
              name="quantity"
              type="number"
              required
              min={1}
              max={100}
              step={1}
              value={quantity}
              aria-invalid={invalid("quantity")}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>
          {invalid("quantity") && (
            <p className="error" role="alert">
              Введіть ціле число від 1 до 100.
            </p>
          )}
        </div>
        <button className="button primary" type="submit" disabled={pending}>
          {order
            ? mutation.isPending
              ? "Зберігаємо…"
              : "Зберегти зміни"
            : mutation.isPending
              ? "Створюємо…"
              : "Створити"}
        </button>
      </form>
      <div className="form-footer">
        <span>
          Підсумок{" "}
          <strong>
            {money.format((Number(quantity) || 0) * orderUnitPrice)}
          </strong>
        </span>
      </div>
      {error && !serverFields.length && (
        <p className="error" role="alert">
          {orderError(
            error,
            order
              ? "Не вдалося зберегти замовлення."
              : "Не вдалося створити замовлення.",
          )}
        </p>
      )}
    </section>
  );
}

export function OrdersPanel() {
  const owner = useSelectedUser();
  const users = useUsers();
  const activeUser = users.data?.find((user) => user.id === owner);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const query = useQuery(ordersQuery(owner));
  const { count, total, filtering, rows } = orderHistory(
    query.data ?? [],
    search,
    status,
  );

  return (
    <section className="orders-panel">
      <div className="summary-grid">
        <div className="summary-card">
          <span>Замовлень користувача</span>
          <strong>{String(count).padStart(2, "0")}</strong>
        </div>
        <div className="summary-card accent">
          <span>Загальна сума</span>
          <strong>{money.format(total)}</strong>
        </div>
      </div>
      <OrderForm key={owner} owner={owner} />
      <section className="panel history">
        <div className="panel-heading">
          <h2>
            {activeUser
              ? `Замовлення · ${activeUser.name}`
              : "Оберіть користувача"}
          </h2>
          <span className="muted" role="status">
            {query.isFetching ? "Завантажуємо замовлення…" : ""}
          </span>
        </div>
        {query.isError && (
          <p className="error" role="alert">
            Не вдалося завантажити замовлення.
          </p>
        )}
        <div className="order-filters">
          <label className="search-label">
            <span>Пошук товару</span>
            <input
              type="search"
              placeholder="Назва товару"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            Статус
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">Усі замовлення</option>
              <option value="created">Створені</option>
              <option value="cancelled">Скасовані</option>
            </select>
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Товар</th>
                <th>Кількість</th>
                <th>Сума</th>
                <th>Статус</th>
                <th>Дії</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={order.id}>
                  <td>
                    <strong>
                      <Link to={generatePath(paths.order, { id: order.id })}>
                        {order.product}
                      </Link>
                    </strong>
                    <small>#{order.id.slice(0, 8)}</small>
                  </td>
                  <td>{order.quantity}</td>
                  <td>{money.format(order.total)}</td>
                  <td>
                    <span className="order-status">
                      {order.cancelled ? "Скасовано" : "Створено"}
                    </span>
                  </td>
                  <td>
                    {!order.cancelled && (
                      <CancelOrder owner={owner} id={order.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && !query.isFetching && !query.isError && (
          <div className="empty order-empty">
            <strong>
              {filtering
                ? "Замовлень не знайдено"
                : "Тут з’являться замовлення"}
            </strong>
            <p>
              {filtering
                ? "Змініть пошук або статус замовлення."
                : "Створіть перше замовлення для цього користувача."}
            </p>
          </div>
        )}
      </section>
    </section>
  );
}
