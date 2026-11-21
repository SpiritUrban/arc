import type { PageContext, pageView, View } from "../web/view.js";
import type { TemplateElement } from "../web/jsx-runtime.js";

export function rootView(root: unknown, id: string, createView?: typeof pageView): View {
  if (typeof root === "function" && createView)
    return createView(id, root as (context: PageContext) => TemplateElement);
  if (root && typeof root === "object" && "kind" in root && root.kind === "view" &&
      "setup" in root && typeof root.setup === "function")
    return root as View;
  throw new Error(`Default-export an ARC view or page function for ${id}`);
}
