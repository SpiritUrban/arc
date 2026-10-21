import { compileArchitecture, type GraphDefinition } from "../neutral/graph.js";
import { silentTelemetry, type WebTelemetry } from "../neutral/protocol.js";
import { mount, type View } from "./view.js";
export function webApplication(options: {
  nodes: readonly GraphDefinition[];
  telemetry?: WebTelemetry;
}) {
  let disposed = false;
  const disposers: (() => void)[] = [];
  const nodes: GraphDefinition[] = [];
  const seen = new Set<GraphDefinition>();
  const collect = (n: GraphDefinition) => {
    if (seen.has(n) || n.runtime === "server" || n.kind === "operation") return;
    seen.add(n);
    nodes.push(n);
    for (const d of n.dependencies ?? []) collect(d);
    for (const r of n.relations ?? []) collect(r.to);
  };
  return {
    compile() {
      const ir = compileArchitecture(options.nodes);
      for (const node of options.nodes) collect(node);
      return ir;
    },
    start() {
      if (disposed) throw new Error("Disposed web application");
      if (!nodes.length) this.compile();
      for (const n of nodes)
        if (
          n.metadata?.scope !== "view" &&
          "activate" in n &&
          typeof n.activate === "function"
        )
          n.activate(options.telemetry ?? silentTelemetry);
    },
    mount(view: View, target: Element) {
      if (disposed) throw new Error("Disposed web application");
      if (!seen.has(view)) throw new Error("View not declared in application");
      const instance = mount(view, target, { telemetry: options.telemetry });
      disposers.push(() => instance.unmount());
      return instance;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const dispose of disposers.splice(0).reverse()) dispose();
      for (const n of [...nodes].reverse())
        if ("dispose" in n && typeof n.dispose === "function") n.dispose();
      nodes.length = 0;
      seen.clear();
    },
  };
}
