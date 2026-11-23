import type { Infer } from "@arc/framework/core";
import type { Signal } from "@arc/framework/web";
import type { CreateOrder } from "./contracts.ts";

type OrderInput = Infer<typeof CreateOrder.input>;

interface OrderFieldsProps {
  mutation: { invalid(field: keyof OrderInput): boolean };
  order?: () => OrderInput | undefined;
  quantity?: Signal<string>;
}

export function OrderFields({ mutation, order, quantity }: OrderFieldsProps) {
  const quantityBinding = quantity ? { "bind:value": quantity } : {};
  return (
    <>
      <label class="product-field">
        Назва товару
        <input
          data-product
          required
          maxlength="100"
          placeholder="Наприклад, блокнот ARC"
          name="product"
          value={order?.()?.product}
          aria-invalid={mutation.invalid("product")}
        />
        <span class="error" role="alert" data-product-error>
          {mutation.invalid("product") && "Вкажіть назву товару."}
        </span>
      </label>
      <div class="quantity-field">
        <label>
          Кількість
          <input
            data-quantity
            name="quantity"
            required
            type="number"
            min="1"
            max="100"
            step="1"
            value={order?.()?.quantity}
            aria-invalid={mutation.invalid("quantity")}
            {...quantityBinding}
          />
        </label>
        <p class="error" role="alert" data-quantity-error>
          {mutation.invalid("quantity") && "Введіть ціле число від 1 до 100."}
        </p>
      </div>
    </>
  );
}
