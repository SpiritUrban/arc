import type { PageLayoutContext } from "@arc/framework/web";
import { ordersPath } from "../../orders/paths.ts";

export const styles = `
.orders-area > nav { display:flex; gap:10px; margin-bottom:18px; }
.orders-area > nav a { color:inherit; }
`;

export default function OrdersLayout({ children }: PageLayoutContext) {
  return (
    <div class="orders-area">
      <nav aria-label="Навігація замовлень">
        <a href={ordersPath}>Усі замовлення</a>
      </nav>
      {children}
    </div>
  );
}
