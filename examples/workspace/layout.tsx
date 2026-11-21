import type { PageLayoutContext } from "@arc/framework/web";

export { styles } from "./styles.ts";
export const title = "ARC Workspace — користувачі та замовлення";

export default function Layout({ children, route }: PageLayoutContext) {
  const overview = route === "/";
  const heading = overview
    ? "Огляд"
    : route === "/orders"
      ? "Замовлення"
      : "Деталі замовлення";

  return (
    <div class="workspace">
      <aside class="sidebar">
        <a class="brand" href="/" aria-label="ARC Workspace">
          <span class="brand-icon">A</span>ARC<span class="brand-dot">.</span>
        </a>
        <nav aria-label="Робочий простір">
          <div class="workspace-label">РОБОЧИЙ ПРОСТІР</div>
          <a
            class={overview ? "nav-item active" : "nav-item"}
            href="/"
            aria-current={overview ? "page" : undefined}
          >
            <span>▦</span> Огляд
          </a>
          <a class="nav-item" href="/#users">
            <span>◎</span> Користувачі
          </a>
          <a
            class={!overview ? "nav-item active" : "nav-item"}
            href="/orders"
            aria-current={route === "/orders" ? "page" : undefined}
          >
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
            <strong>{heading}</strong>
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
