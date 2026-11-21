import { webApplication } from "@arc/framework/web";
import { Counter } from "./page.tsx";
// compile збирає граф залежностей, start запускає його, а mount вставляє шаблон у #app.
const app = webApplication({ nodes: [Counter] });
app.compile();
app.start();
app.mount(Counter, document.querySelector("#app")!);
// Під час виходу зі сторінки dispose прибирає підписки та обробники подій.
window.addEventListener("pagehide", () => app.dispose(), { once: true });
