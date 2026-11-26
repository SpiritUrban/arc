import type { PageLayoutContext } from "@arc/framework/web";
import { ordersPath } from "../orders/paths.ts";

export { styles } from "../styles.ts";
export const title = "ARC Workspace — користувачі та замовлення";

export default function Layout({ children }: PageLayoutContext) {
  return (
    <div class="workspace">
      <aside class="sidebar">
        <a class="brand" href="/" aria-label="ARC Workspace">
          <span class="brand-icon">A</span>ARC<span class="brand-dot">.</span>
        </a>
        <nav aria-label="Робочий простір">
          <div class="workspace-label">РОБОЧИЙ ПРОСТІР</div>
          <a class="nav-item" href="/">
            <span>▦</span> Огляд
          </a>
          <a class="nav-item" href="/#users">
            <span>◎</span> Користувачі
          </a>
          <a class="nav-item" href={ordersPath}>
            <span>▤</span> Замовлення
          </a>
        </nav>
        <div class="sidebar-bottom">
          <span class="connection-dot"></span>
          <div>
            <strong>Локальне середовище</strong>
            <small>Дані зберігаються в пам’яті</small>
          </div>
        </div>
      </aside>
      <div class="workspace-main">
        <header class="topbar">
          <span>
            Workspace <span class="breadcrumb">/</span>{" "}
            <strong>ARC Workspace</strong>
          </span>
          <span class="environment">
            <span class="connection-dot"></span> Development
          </span>
        </header>
        <main>
          {children}
          <footer>
            Побудовано на ARC{" "}
            <span>Один application graph · Browser / Server / Shared</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
