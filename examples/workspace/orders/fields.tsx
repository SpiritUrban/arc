import type { Infer } from "@arc/framework/core";
import type { Mutation } from "@arc/framework/fullstack";
import type { Signal } from "@arc/framework/web";
import { quantityLimits, type CreateOrder } from "./contracts.ts";

type OrderInput = Infer<typeof CreateOrder.input>;

interface OrderFieldsProps {
  mutation: Pick<Mutation<typeof CreateOrder>, "fieldsFor">;
  order?: () => OrderInput | undefined;
  quantity?: Signal<string>;
}

export function OrderFields({ mutation, order, quantity }: OrderFieldsProps) {
  const { product, quantity: quantityField } = mutation.fieldsFor("product", "quantity");
  return (
    <>
      <label class="product-field">
        Назва товару
        <input
          data-product
          {...product.input}
          placeholder="Наприклад, блокнот ARC"
          value={order?.()?.product}
        />
        <span class="error" role="alert" data-product-error>
          {product.errorMessage("Вкажіть назву товару.")}
        </span>
      </label>
      <div class="quantity-field">
        <label>
          Кількість
          <input
            data-quantity
            {...quantityField.input}
            value={order?.()?.quantity}
            bind:value={quantity}
          />
        </label>
        <p class="error" role="alert" data-quantity-error>
          {quantityField.errorMessage(
            `Введіть ціле число від ${quantityLimits.min} до ${quantityLimits.max}.`,
          )}
        </p>
      </div>
    </>
  );
}
