import { compileArchitecture, type GraphDefinition } from "../neutral/graph.js";
import {
  browserEvent,
  identity,
  silentTelemetry,
  type TraceToken,
  type WebTelemetry,
} from "../neutral/protocol.js";
import { Scope, type Readable, type Writable } from "./reactive.js";
export interface Binding extends GraphDefinition {
  kind: "binding";
  type: "text" | "property" | "attribute" | "event" | "visible";
  sources: readonly Readable<any>[];
  name?: string;
  format?: (...values: any[]) => unknown;
  handler?:
    | ((event: Event, trace: TraceToken) => unknown)
    | {
        execute(input: any, context?: { trace?: TraceToken }): Promise<unknown>;
      };
  input?: unknown;
}
export function binding(
  def: Omit<Binding, "kind" | "runtime" | "dependencies" | "relations">,
): Binding {
  return {
    ...def,
    kind: "binding",
    runtime: "browser",
    dependencies: [
      ...def.sources,
      ...((def.handler as any)?.id
        ? [def.handler as unknown as GraphDefinition]
        : []),
    ],
    relations: [
      ...def.sources.map((source) => ({ to: source, kind: "BINDS" as const })),
      ...((def.handler as any)?.id
        ? [
            {
              to: def.handler as unknown as GraphDefinition,
              kind: "TRIGGERS" as const,
            },
          ]
        : []),
    ],
  };
}
export interface View extends GraphDefinition {
  kind: "view";
  bindings: readonly Binding[];
  owned?: readonly (GraphDefinition & { dispose(): void })[];
  setup(ctx: {
    document: Document;
    scope: Scope;
    bind(binding: Binding, node: Element): void;
  }): Node;
}
export function view(
  def: Omit<View, "kind" | "runtime" | "dependencies"> & {
    needs?: Record<string, GraphDefinition>;
  },
): View {
  return {
    ...def,
    kind: "view",
    runtime: "browser",
    dependencies: [
      ...Object.values(def.needs ?? {}),
      ...def.bindings,
      ...((def.owned ?? []) as GraphDefinition[]),
    ],
  };
}
export function mount(
  def: View,
  target: Element,
  options: { telemetry?: WebTelemetry } = {},
) {
  compileArchitecture([def]);
  const scope = new Scope(),
    telemetry = options.telemetry ?? silentTelemetry;
  let root: Node | undefined;
  const bind = (b: Binding, element: Element) => {
    if (!def.bindings.includes(b))
      throw new Error(`Undeclared binding: ${b.id}`);
    if (b.type === "event") {
      const listener = (event: Event) => {
        const trace = { traceId: identity() };
        browserEvent(telemetry, b.id, "binding.event", trace);
        try {
          const result =
            typeof b.handler === "function"
              ? b.handler(event, trace)
              : b.handler?.execute(b.input, { trace });
          if (result && typeof (result as any).catch === "function")
            void (result as Promise<unknown>).catch((error) =>
              browserEvent(telemetry, b.id, "binding.error", trace, {
                data: { message: String(error) },
              }),
            );
        } catch (error) {
          browserEvent(telemetry, b.id, "binding.error", trace, {
            data: { message: String(error) },
          });
        }
      };
      element.addEventListener(b.name ?? "click", listener);
      scope.add(() => element.removeEventListener(b.name ?? "click", listener));
      return;
    }
    const update = () => {
      if (scope.disposed) return;
      const start = performance.now(),
        values = b.sources.map((s) => s.get()),
        value = b.format ? b.format(...values) : values[0];
      if (b.type === "text") element.textContent = String(value ?? "");
      else if (b.type === "property") (element as any)[b.name!] = value;
      else if (b.type === "attribute") {
        if (value === false || value == null) element.removeAttribute(b.name!);
        else element.setAttribute(b.name!, String(value));
      } else (element as HTMLElement).hidden = !value;
      browserEvent(
        telemetry,
        b.id,
        "binding.updated",
        b.sources.find((s) => s._trace)?._trace,
        { duration: performance.now() - start, data: { view: def.id } },
      );
    };
    update();
    for (const source of b.sources) scope.add(source.subscribe(update));
  };
  try {
    for (const item of def.owned ?? []) {
      scope.own(item);
      if ("activate" in item && typeof item.activate === "function")
        item.activate(telemetry);
    }
    root = def.setup({ document: target.ownerDocument, scope, bind });
    target.appendChild(root);
    browserEvent(telemetry, def.id, "view.mounted");
  } catch (error) {
    scope.dispose();
    throw error;
  }
  return {
    scope,
    unmount() {
      if (scope.disposed) return;
      scope.dispose();
      if (root?.parentNode) root.parentNode.removeChild(root);
      root = undefined;
      browserEvent(telemetry, def.id, "view.unmounted");
    },
    dispose() {
      this.unmount();
    },
  };
}
