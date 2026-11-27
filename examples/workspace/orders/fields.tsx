import type { MutationFieldBindings } from "@arc/framework/fullstack";
import type { Signal } from "@arc/framework/web";
import { CreateOrder, quantityLimits, type OrderFormInput } from "./contracts.ts";

const quantityError = `Введіть ціле число від ${quantityLimits.min} до ${quantityLimits.max}.`;

type OrderFieldsProps = {
  mutation: MutationFieldBindings<OrderFormInput>;
} & (
  | { quantity: Signal<string>; savedValues?: never }
  | { savedValues: () => OrderFormInput | undefined; quantity?: never }
);

export function OrderFields({ mutation, savedValues, quantity }: OrderFieldsProps) {
  const { product, quantity: quantityField } = mutation.fieldsFor(CreateOrder.input);
  return (
    <>
      <label class="product-field">
        Назва товару
        <input
          data-product
          {...product.input}
          placeholder="Наприклад, блокнот ARC"
          value={savedValues?.()?.product}
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
            value={savedValues?.()?.quantity}
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
