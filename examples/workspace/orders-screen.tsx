import { OrdersPage } from "./orders/page.tsx";
import { UsersPage } from "./users/page.tsx";

export { styles } from "./styles.ts";
export const title = "Замовлення — ARC Workspace";

export default function OrdersScreen() {
  return (
    <main>
      <a class="brand" href="/" style="color:#24324a;margin:0 0 18px">
        ARC Workspace
      </a>
      <h1>Замовлення</h1>
      <div class="content-grid">
        <div id="users">{UsersPage}</div>
        <div id="orders">{OrdersPage}</div>
      </div>
    </main>
  );
}
