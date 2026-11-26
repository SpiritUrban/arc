import type { Infer, OperationContract } from "@arc/framework/core";
import type { Mutation } from "@arc/framework/fullstack";
import type { Signal } from "@arc/framework/web";
import { OrderFormInput } from "./contracts.ts";

type OrderInput = Infer<typeof OrderFormInput>;

interface OrderFieldsProps {
  mutation: Pick<Mutation<OperationContract<OrderInput>>, "fieldsFor">;
  order?: () => OrderInput | undefined;
  quantity?: Signal<string>;
}

export function OrderFields({ mutation, order, quantity }: OrderFieldsProps) {
  const { product, quantity: quantityField } = mutation.fieldsFor(OrderFormInput);
  const { min, max } = quantityField.input;
  const quantityError = min !== undefined && max !== undefined
    ? `Введіть ціле число від ${min} до ${max}.`
    : "Перевірте кількість товару.";
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
          {quantityField.errorMessage(quantityError)}
        </p>
      </div>
    </>
  );
}
