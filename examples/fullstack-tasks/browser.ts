import { webApplication } from "@arc/framework/web";
import { telemetryTransport } from "@arc/framework/fullstack";
import { TasksPage } from "./page.ts";
const telemetry = telemetryTransport(),
  app = webApplication({ nodes: [TasksPage], telemetry });
app.compile();
app.start();
app.mount(TasksPage, document.querySelector("#app")!);
window.addEventListener(
  "pagehide",
  () => {
    app.dispose();
    void telemetry.dispose();
  },
  { once: true },
);
