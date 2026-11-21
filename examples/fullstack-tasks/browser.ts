import { webApplication } from "@arc/framework/web";
import { telemetryTransport } from "@arc/framework/fullstack";
import { TasksPage } from "./page.tsx";
// Телеметрія передає події браузера, щоб у Stand можна було простежити виклик до сервера.
const telemetry = telemetryTransport(),
  app = webApplication({ nodes: [TasksPage], telemetry });
app.compile();
app.start();
app.mount(TasksPage, document.querySelector("#app")!);
// Закриваємо підписки сторінки й транспорт телеметрії під час виходу.
window.addEventListener(
  "pagehide",
  () => {
    app.dispose();
    void telemetry.dispose();
  },
  { once: true },
);
