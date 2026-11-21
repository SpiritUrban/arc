import { application, module } from "@arc/framework/core";
import { Counter } from "./page.tsx";
// Цей граф описує браузерну сторінку для CLI та Stand.
// web.entry вказує, звідки починається збірка для браузера.
export default application({
  modules: [
    module({
      id: "counter",
      web: { nodes: [Counter], entry: "examples/web-counter/browser.ts" },
    }),
  ],
});
