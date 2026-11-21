import { startWeb } from "../web/runtime.js";
import { layoutView, rootView } from "../neutral/page-root.js";
import { matchPagePath, pageParamNames } from "../neutral/page-path.js";
import { pageView } from "../web/view.js";
import { telemetryTransport } from "./client.js";

type PageModule = { default: unknown; title?: string; styles?: string };

export function bootstrapPage(
  page: PageModule,
  id: string,
  path: string,
  layouts: readonly PageModule[] = [],
) {
  const target = document.getElementById("app");
  if (!target) throw new Error("ARC page requires an #app container");

  const title = page.title ?? [...layouts].reverse().find((layout) => layout.title)?.title;
  if (title) document.title = title;
  const styles = [...layouts.map((layout) => layout.styles), page.styles].filter(Boolean).join("\n");
  const style = styles ? document.createElement("style") : undefined;
  if (style) {
    style.textContent = styles;
    document.head.append(style);
  }
  const telemetry = telemetryTransport();
  try {
    const params = pageParamNames(path).length ? matchPagePath(path, window.location.pathname) : {};
    if (!params) throw new Error(`URL does not match ARC page ${path}`);
    const pageRoot = rootView(page.default, id, pageView, params);
    const root = layouts.reduceRight((child, layout, index) => layoutView(
      layout.default, child, path, pageView, params,
      index === 0 ? `layout:${path}` : `layout:${path}:${index}`,
    ), pageRoot);
    const app = startWeb(root, target, { telemetry });
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
