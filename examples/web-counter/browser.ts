import { webApplication } from "@arc/framework/web";
import { Counter } from "./page.ts";
const app = webApplication({ nodes: [Counter] });
app.compile();
app.start();
app.mount(Counter, document.querySelector("#app")!);
window.addEventListener("pagehide", () => app.dispose(), { once: true });
