// Точка входу ARC Workspace. CLI завантажує цей файл і запускає HTTP-хост.
// Реалізація серверних операцій лежить у users/server.ts та orders/server.ts.
import { application, operation, s, ok, http } from "@arc/framework";
import { users } from "./users/server.ts";
import { orders } from "./orders/server.ts";
import { WorkspacePage } from "./page.tsx";
// Окремий HTTP-маршрут /health дає змогу перевірити, що сервер відповідає.
const health = operation({
  id: "system.health",
  input: s.object({}),
  output: s.object({ status: s.literal("ok") }),
  run: () => ok({ status: "ok" as const }),
});
// Серверні модулі реєструють операції та REST-маршрути.
// web.nodes додає браузерну частину до спільного графа, а web.entry задає точку входу збірки.
export const createApp = () =>
  application({
    modules: [users, orders],
    web: { nodes: [WorkspacePage], entry: "examples/workspace/browser.ts" },
    operations: [health],
    routes: [http.get("/health", health)],
  });

export default createApp();
