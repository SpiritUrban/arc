import type { Infer } from "@arc/framework/core";
import type { Signal } from "@arc/framework/web";
import { productMaxLength, quantityLimits, type CreateOrder } from "./contracts.ts";

type OrderInput = Infer<typeof CreateOrder.input>;

interface OrderFieldsProps {
  mutation: { invalid(field: keyof OrderInput): boolean };
  order?: () => OrderInput | undefined;
  quantity?: Signal<string>;
}

export function OrderFields({ mutation, order, quantity }: OrderFieldsProps) {
  return (
    <>
      <label class="product-field">
        Назва товару
        <input
          data-product
          required
          maxlength={productMaxLength}
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
            min={quantityLimits.min}
            max={quantityLimits.max}
            step="1"
            value={order?.()?.quantity}
            aria-invalid={mutation.invalid("quantity")}
            bind:value={quantity}
          />
        </label>
        <p class="error" role="alert" data-quantity-error>
          {mutation.invalid("quantity") &&
            `Введіть ціле число від ${quantityLimits.min} до ${quantityLimits.max}.`}
        </p>
      </div>
    </>
  );
}
