import type { PageContext, PageLayoutContext, pageView, View } from "../web/view.js";
import type { TemplateElement } from "../web/jsx-runtime.js";

export function rootView(root: unknown, id: string, createView?: typeof pageView, params?: Readonly<Record<string, string>>): View {
  if (root && (typeof root === "object" || typeof root === "function") && "kind" in root && root.kind === "view" &&
      "setup" in root && typeof root.setup === "function")
    return root as View;
  if (typeof root === "function" && createView)
    return createView(id, root as (context: PageContext) => TemplateElement, params);
  throw new Error(`Default-export an ARC view or page function for ${id}`);
}

export function layoutView(
  layout: unknown,
  child: View,
  route: string,
  createView: typeof pageView,
  params: Readonly<Record<string, string>>,
  id = `layout:${route}`,
): View {
  if (typeof layout !== "function") throw new Error("Default-export a function from the ARC layout");
  const render = layout as (context: PageLayoutContext) => TemplateElement;
  return createView(id, (context) =>
    render({ ...context, route, children: child }), params,
  );
}
