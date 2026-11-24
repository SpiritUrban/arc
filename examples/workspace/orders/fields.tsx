import type { Infer } from "@arc/framework/core";
import type { Mutation } from "@arc/framework/fullstack";
import type { Signal } from "@arc/framework/web";
import { productMaxLength, quantityLimits, type CreateOrder } from "./contracts.ts";

type OrderInput = Infer<typeof CreateOrder.input>;

interface OrderFieldsProps {
  mutation: Pick<Mutation<typeof CreateOrder>, "invalidField">;
  order?: () => OrderInput | undefined;
  quantity?: Signal<string>;
}

export function OrderFields({ mutation, order, quantity }: OrderFieldsProps) {
  const productInvalid = mutation.invalidField("product");
  const quantityInvalid = mutation.invalidField("quantity");
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
          aria-invalid={productInvalid}
        />
        <span class="error" role="alert" data-product-error>
          {productInvalid() && "Вкажіть назву товару."}
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
            aria-invalid={quantityInvalid}
            bind:value={quantity}
          />
        </label>
        <p class="error" role="alert" data-quantity-error>
          {quantityInvalid() &&
            `Введіть ціле число від ${quantityLimits.min} до ${quantityLimits.max}.`}
        </p>
      </div>
    </>
  );
}
