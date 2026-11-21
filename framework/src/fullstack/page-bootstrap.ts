import { startWeb } from "../web/runtime.js";
import { rootView } from "../neutral/page-root.js";
import { matchPagePath, pageParamNames } from "../neutral/page-path.js";
import { pageView } from "../web/view.js";
import { telemetryTransport } from "./client.js";

export function bootstrapPage(
  page: { default: unknown; title?: string; styles?: string },
  id: string,
  path: string,
) {
  const target = document.getElementById("app");
  if (!target) throw new Error("ARC page requires an #app container");

  if (page.title) document.title = page.title;
  const style = page.styles ? document.createElement("style") : undefined;
  if (style) {
    style.textContent = page.styles!;
    document.head.append(style);
  }
  const telemetry = telemetryTransport();
  try {
    const params = pageParamNames(path).length ? matchPagePath(path, window.location.pathname) : {};
    if (!params) throw new Error(`URL does not match ARC page ${path}`);
    const app = startWeb(rootView(page.default, id, pageView, params), target, { telemetry });
    window.addEventListener("pagehide", () => {
      try {
        app.dispose();
      } finally {
        style?.remove();
        void telemetry.dispose();
      }
    }, { once: true });
  } catch (error) {
    style?.remove();
    void telemetry.dispose();
    throw error;
  }
}
