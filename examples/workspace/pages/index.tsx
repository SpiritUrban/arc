import { view } from "@arc/framework/web";
import { UsersPage } from "../users/page.tsx";
import { OrdersPage } from "../orders/page.tsx";

export default view({
  id: "workspace.page",
  template: (
    <section id="overview">
      <div class="page-heading">
        <div>
          <span class="eyebrow">ВАШ РОБОЧИЙ ПРОСТІР</span>
          <h1>
            Усе починається з людей<span>.</span>
          </h1>
          <p>Керуйте користувачами та їхніми замовленнями в одному місці.</p>
        </div>
        <span class="project-tag">ARC / FULLSTACK</span>
      </div>
      <div class="demo-note">
        <span>↗</span>
        <p>
          <strong>Знайомтеся з ARC Workspace.</strong> Оберіть користувача
          зліва, щоб переглянути його замовлення. Авторизація демонстраційна —
          вибір користувача передає його ID як Bearer token.
        </p>
      </div>
      <div class="content-grid">
        <div id="users">{UsersPage}</div>
        <div id="orders">{OrdersPage}</div>
      </div>
    </section>
  ),
});
