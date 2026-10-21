import { webApplication } from "@arc/framework/web";
import { telemetryTransport } from "@arc/framework/fullstack";
import { WorkspacePage } from "./page.ts";
import { UsersPage } from "./users/page.ts";
import { OrdersPage } from "./orders/page.ts";
import { styles } from "./styles.ts";
document.title = "ARC Workspace — користувачі та замовлення";
const style = document.createElement("style");
style.textContent = styles;
document.head.append(style);
const telemetry = telemetryTransport();
const app = webApplication({ nodes: [WorkspacePage], telemetry });
app.compile();
app.start();
app.mount(WorkspacePage, document.querySelector("#app")!);
app.mount(UsersPage, document.querySelector("#users")!);
app.mount(OrdersPage, document.querySelector("#orders")!);
window.addEventListener(
  "pagehide",
  () => {
    app.dispose();
    style.remove();
    void telemetry.dispose();
  },
  { once: true },
);
