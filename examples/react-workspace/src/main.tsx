import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useParams,
} from "react-router";
import { styles } from "../../workspace/styles.ts";
import { OrdersPanel } from "./orders/panel.tsx";
import { paths } from "./paths.ts";
import { UserSelection, UsersPanel } from "./users/panel.tsx";

const queryClient = new QueryClient();

function WorkspaceLayout() {
  return (
    <div className="workspace">
      <style>{styles}</style>
      <aside className="sidebar">
        <Link
          className="brand"
          to={paths.overview}
          aria-label="React Workspace"
        >
          React
        </Link>
        <nav aria-label="Робочий простір">
          <NavLink className="nav-item" to={paths.overview} end>
            Огляд
          </NavLink>
          <NavLink className="nav-item" to={paths.orders}>
            Замовлення
          </NavLink>
        </nav>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <strong>React Workspace</strong>
        </header>
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function OrderDetail() {
  const { id } = useParams<"id">();
  return (
    <section>
      <Link to={paths.orders}>← Усі замовлення</Link>
      <h1>Деталі замовлення</h1>
      <p>Замовлення {id}</p>
      <div className="content-grid">
        <UsersPanel />
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <UserSelection>
        <BrowserRouter>
          <Routes>
            <Route element={<WorkspaceLayout />}>
              <Route
                path={paths.overview}
                element={
                  <>
                    <h1>Огляд</h1>
                    <div className="content-grid">
                      <UsersPanel />
                      <OrdersPanel />
                    </div>
                  </>
                }
              />
              <Route
                path={paths.orders}
                element={
                  <>
                    <h1>Замовлення</h1>
                    <div className="content-grid">
                      <UsersPanel />
                      <OrdersPanel />
                    </div>
                  </>
                }
              />
              <Route path={paths.order} element={<OrderDetail />} />
              <Route path="*" element={<h1>Сторінку не знайдено</h1>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </UserSelection>
    </QueryClientProvider>
  </StrictMode>,
);
