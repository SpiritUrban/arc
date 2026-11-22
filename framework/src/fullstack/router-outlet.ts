import type { signal } from "../web/reactive.js";
import type { outlet, view, View } from "../web/view.js";

export function emptyRouteView(createView: typeof view): View {
  return createView({
    id: "router:empty",
    bindings: [],
    setup({ document }) {
      const placeholder = document.createElement("div");
      placeholder.style.display = "contents";
      return placeholder;
    },
  });
}

export function routerOutlet(
  path: string,
  initial: View,
  choices: readonly View[],
  runtime: { signal: typeof signal; outlet: typeof outlet },
) {
  const key = path || "root";
  const current = runtime.signal<View>({
    id: `router:${key}`,
    initial,
    scope: "application",
  });
  return { current, view: runtime.outlet(`router-outlet:${key}`, current, choices) };
}
