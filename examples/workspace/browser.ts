import { startWeb } from "@arc/framework/web";
import { telemetryTransport } from "@arc/framework/fullstack";
import { WorkspacePage } from "./page.tsx";
import { styles } from "./styles.ts";
document.title = "ARC Workspace — користувачі та замовлення";
const style = document.createElement("style");
style.textContent = styles;
document.head.append(style);
// Телеметрія пов’язує браузерні дії та зміни UI із серверними викликами в Stand.
const telemetry = telemetryTransport();
const app = startWeb(WorkspacePage, document.querySelector("#app")!, { telemetry });
// Коли браузер залишає сторінку, звільняємо підписки, стилі та транспорт телеметрії.
window.addEventListener(
  "pagehide",
  () => {
    app.dispose();
    style.remove();
    void telemetry.dispose();
  },
  { once: true },
);
