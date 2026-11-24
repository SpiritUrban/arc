import type { Infer } from "@arc/framework/core";
import type { Mutation } from "@arc/framework/fullstack";
import type { Signal } from "@arc/framework/web";
import { quantityLimits, type CreateOrder } from "./contracts.ts";

type OrderInput = Infer<typeof CreateOrder.input>;

interface OrderFieldsProps {
  mutation: Pick<Mutation<typeof CreateOrder>, "field">;
  order?: () => OrderInput | undefined;
  quantity?: Signal<string>;
}

export function OrderFields({ mutation, order, quantity }: OrderFieldsProps) {
  const { input: productInput, invalid: productInvalid } = mutation.field("product");
  const { input: quantityInput, invalid: quantityInvalid } = mutation.field("quantity");
  return (
    <>
      <label class="product-field">
        Назва товару
        <input
          data-product
          {...productInput}
          placeholder="Наприклад, блокнот ARC"
          value={order?.()?.product}
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
            {...quantityInput}
            value={order?.()?.quantity}
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
