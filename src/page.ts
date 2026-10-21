import { view } from "@arc/framework/web";
import { UsersPage } from "./users/page.ts";
import { OrdersPage } from "./orders/page.ts";
export const WorkspacePage = view({
  id: "workspace.page",
  bindings: [],
  needs: { users: UsersPage, orders: OrdersPage },
  setup({ document }) {
    const root = document.createElement("div");
    root.className = "workspace";
    root.innerHTML = `<aside class="sidebar"><a class="brand" href="/" aria-label="ARC Workspace"><span class="brand-icon">A</span>ARC<span class="brand-dot">.</span></a><div class="workspace-label">РОБОЧИЙ ПРОСТІР</div><a class="nav-item active" href="#overview"><span>▦</span> Огляд <span class="nav-dot"></span></a><a class="nav-item" href="#users"><span>◎</span> Користувачі</a><a class="nav-item" href="#orders"><span>▤</span> Замовлення</a><div class="sidebar-bottom"><span class="connection-dot"></span><div><strong>Локальне середовище</strong><small>Дані зберігаються в пам’яті</small></div></div></aside><div class="workspace-main"><header class="topbar"><span>Workspace <span class="breadcrumb">/</span> <strong>Огляд</strong></span><span class="environment"><span class="connection-dot"></span> Development</span></header><main id="overview"><div class="page-heading"><div><span class="eyebrow">ВАШ РОБОЧИЙ ПРОСТІР</span><h1>Усе починається з людей<span>.</span></h1><p>Керуйте користувачами та їхніми замовленнями в одному місці.</p></div><span class="project-tag">ARC / FULLSTACK</span></div><div class="demo-note"><span>↗</span><p><strong>Знайомтеся з ARC Workspace.</strong> Оберіть користувача зліва, щоб переглянути його замовлення. Авторизація демонстраційна — вибір користувача передає його ID як Bearer token.</p></div><div class="content-grid"><div id="users"></div><div id="orders"></div></div><footer>Побудовано на ARC <span>Один application graph · Browser / Server / Shared</span></footer></main></div>`;
    return root;
  },
});
