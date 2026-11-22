import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../http.ts";
import { useSelectedUser, useUsers } from "../users/panel.tsx";
import { createOrder, ordersKey, ordersQuery } from "./api.ts";
import { orderHistory } from "./history.ts";
import {
  orderInputSchema,
  orderUnitPrice,
  type OrderInput,
} from "./contracts.ts";

const money = new Intl.NumberFormat("uk-UA", {
  style: "currency",
  currency: "UAH",
  maximumFractionDigits: 0,
});

function CreateOrderForm({ owner }: { owner: string }) {
  const [product, setProduct] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const cache = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: OrderInput) => createOrder(owner, input),
    onSuccess: () => cache.invalidateQueries({ queryKey: ordersKey(owner) }),
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
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
      await mutation.mutateAsync(parsed.data);
      setProduct((current) => (current === product ? "" : current));
      setQuantity((current) => (current === quantity ? "1" : current));
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
      <h2>Створити замовлення</h2>
      <form
        className="order-form"
        aria-label="Створити замовлення"
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
        <button
          className="button primary"
          type="submit"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Створюємо…" : "Створити"}
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
          Не вдалося створити замовлення.
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
      <CreateOrderForm key={owner} owner={owner} />
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
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={order.id}>
                  <td>
                    <strong>{order.product}</strong>
                    <small>#{order.id.slice(0, 8)}</small>
                  </td>
                  <td>{order.quantity}</td>
                  <td>{money.format(order.total)}</td>
                  <td>
                    <span className="order-status">
                      {order.cancelled ? "Скасовано" : "Створено"}
                    </span>
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
