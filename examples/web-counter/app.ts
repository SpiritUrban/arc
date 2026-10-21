import { application, module } from "@arc/framework/core";
import { Counter } from "./page.ts";
export default application({
  modules: [
    module({
      id: "counter",
      web: { nodes: [Counter], entry: "examples/web-counter/browser.ts" },
    }),
  ],
});
