import { OrdersPage } from "./orders/page.tsx";
import { UsersPage } from "./users/page.tsx";

export const title = "Замовлення — ARC Workspace";

export default function OrdersScreen() {
  return (
    <section>
      <h1>Замовлення</h1>
      <div class="content-grid">
        <div id="users">{UsersPage}</div>
        <div id="orders">{OrdersPage}</div>
      </div>
    </section>
  );
}
