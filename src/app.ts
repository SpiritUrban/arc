import { application, operation, s, ok, http } from "@arc/framework";
import { users } from "./users/index.ts";
import { orders } from "./orders/index.ts";
import { WorkspacePage } from "./page.ts";
const health = operation({
  id: "system.health",
  input: s.object({}),
  output: s.object({ status: s.literal("ok") }),
  run: () => ok({ status: "ok" as const }),
});
export const createApp = () =>
  application({
    modules: [users, orders],
    web: { nodes: [WorkspacePage], entry: "src/browser.ts" },
    operations: [health],
    routes: [http.get("/health", health)],
  });

export default createApp();
