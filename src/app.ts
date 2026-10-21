import { application, operation, s, ok, http } from "@arc/framework";
import { users } from "./users/index.ts";
import { orders } from "./orders/index.ts";
const health = operation({
  id: "system.health",
  input: s.object({}),
  output: s.object({ status: s.literal("ok") }),
  run: () => ok({ status: "ok" as const }),
});
export default application({
  modules: [users, orders],
  operations: [health],
  routes: [http.get("/health", health)],
});
