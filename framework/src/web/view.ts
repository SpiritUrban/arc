import { compileArchitecture, type GraphDefinition } from "../neutral/graph.js";
import {
  browserEvent,
  identity,
  silentTelemetry,
  type TraceToken,
  type WebTelemetry,
} from "../neutral/protocol.js";
import type { Action } from "./async.js";
import {
  attributeReader,
  boundChild,
  elementBindings,
  Fragment,
  isKeyedList,
  isNestedView,
  isRenderBlock,
  isTemplate,
  renderTemplate,
  type KeyedList,
  type RenderBlock,
  type TemplateChild,
  type TemplateElement,
} from "./jsx-runtime.js";
import { Scope, signal, trackReads, withWriteTrace, type Readable, type Signal, type Writable } from "./reactive.js";

const projection = Symbol("ARC binding projection");
const instantiateView = Symbol("ARC view instance");

export interface Projection<T> {
  readonly [projection]: true;
  readonly source: Readable<unknown>;
  readonly format: (value: unknown) => T;
}

/** Transform an explicit source directly in a read-only JSX binding. */
export function project<T, U>(
  source: Readable<T>,
  format: (value: T) => U,
): Projection<U> {
  return {
    [projection]: true,
    source,
    format: (value) => format(value as T),
  };
}

function isProjection(value: unknown): value is Projection<unknown> {
  return typeof value === "object" && value !== null && projection in value;
}

function isReadable(value: unknown): value is Readable<unknown> {
  const source = value as Partial<Readable<unknown>> | null | undefined;
  return (
    typeof source?.get === "function" && typeof source.subscribe === "function"
  );
}

export type EventHandler = (
  event: Event,
  context: { set<T>(state: Writable<T>, value: T): void },
) => unknown;

export interface Binding extends GraphDefinition {
  kind: "binding";
  type:
    | "text"
    | "property"
    | "attribute"
    | "event"
    | "visible"
    | "children"
    | "each"
    | "render";
  sources: readonly Readable<any>[];
  name?: string;
  format?: (...values: any[]) => unknown;
  readAttribute?: () => unknown;
  submitRunning?: Readable<boolean>;
  list?: KeyedList;
  block?: RenderBlock;
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
  [instantiateView]?(scope: Scope): View;
  bindings: readonly Binding[];
  owned?: readonly (GraphDefinition & { dispose(): void })[];
  setup(ctx: {
    mountView?(view: View, target: DocumentFragment): void;
    document: Document;
    scope: Scope;
    bind(binding: Binding, node: Element | Text | Comment): void;
  }): Node;
}
type ViewOptions = Omit<
  View,
  "kind" | "runtime" | "dependencies" | "setup" | "bindings"
> & {
  needs?: Record<string, GraphDefinition>;
} & (
    | { setup: View["setup"]; bindings: readonly Binding[]; template?: never }
    | {
        template(): TemplateElement;
        bindings?: readonly Binding[];
        setup?: never;
      }
  );

function compileTemplate(id: string, root: TemplateChild) {
  const bindings = new Set<Binding>();
  const views = new Set<View>();

  function visit(child: TemplateChild, path: string): TemplateChild {
    if (Array.isArray(child))
      return child.map((item, index) => visit(item, `${path}.${index}`));
    if (isNestedView(child)) {
      views.add(child);
      return child;
    }
    if (isRenderBlock(child)) {
      const region = binding({
        id: `${id}.dom.${path}.render`,
        type: "render",
        sources: [],
        block: child,
      });
      bindings.add(region);
      return boundChild(region);
    }
    if (isKeyedList(child)) {
      const list = binding({
        id: `${id}.dom.${path}.each`,
        type: "each",
        sources: isReadable(child.source) ? [child.source] : [],
        list: child,
      });
      bindings.add(list);
      return boundChild(list);
    }
    if (isProjection(child) || isReadable(child)) {
      const [text] = directive(`${id}.dom.${path}.text`, "bind:text", child);
      bindings.add(text);
      return boundChild(text);
    }
    if (!isTemplate(child)) return child;

    const { children, bind, ...attributes } = child.props;
    const attached = [...elementBindings(bind)];
    for (const [name, value] of Object.entries(attributes)) {
      if (name === "onClick") {
        delete attributes[name];
        if (value == null) continue;
        if (child.tag === Fragment || typeof value !== "function")
          throw new TypeError("onClick expects a function on an HTML element");
        attached.push(binding({
          id: `${id}.dom.${path}.onClick`,
          type: "event",
          name: "click",
          sources: [],
          handler: (event, trace) => withWriteTrace(trace, () => value(event)),
        }));
        continue;
      }
      const readAttribute = attributeReader(value);
      if (readAttribute) {
        delete attributes[name];
        attached.push(binding({
          id: `${id}.dom.${path}.${name}`,
          type: "attribute",
          name: name === "className" ? "class" : name,
          sources: [],
          readAttribute,
        }));
        continue;
      }
      if (!name.startsWith("bind:") && !name.startsWith("on:")) continue;
      if (child.tag === Fragment)
        throw new Error(`Attach ${name} to an HTML element in ${id}`);
      delete attributes[name];
      attached.push(...directive(`${id}.dom.${path}.${name}`, name, value));
    }
    for (const item of attached) bindings.add(item);
    return {
      ...child,
      props: {
        ...attributes,
        children: visit(children, `${path}.0`),
        bind: attached.length ? attached : undefined,
      },
    };
  }

  const compiled = visit(root, "0");
  return { root: compiled, bindings: [...bindings], views };
}

function directive(id: string, name: string, value: unknown): Binding[] {
  if (name.startsWith("on:")) {
    const event = name.slice(3);
    if (event && typeof value === "function") {
      const handler = value as EventHandler;
      return [binding({
        id,
        type: "event",
        name: event,
        sources: [],
        handler(domEvent, trace) {
          if (event === "submit") domEvent.preventDefault();
          return handler(domEvent, {
            set(state, next) {
              state._trace = trace;
              state.set(next);
            },
          });
        },
      })];
    }
    const action = value as Action<void, unknown> | undefined;
    if (
      !event ||
      action?.kind !== "action" ||
      typeof action.execute !== "function"
    )
      throw new TypeError(`${name} expects an ARC action or event handler`);
    const node = binding({
      id,
      type: "event",
      name: event,
      sources: [],
      handler: action,
    });
    if (event === "submit") {
      node.submitRunning = action.running;
      node.handler = (event, trace) => {
        event.preventDefault();
        if (action.get().running) return;
        if (action.submitForm) {
          const form = event.currentTarget;
          if ((form as Element | null)?.localName !== "form")
            throw new TypeError("A named-field action must be attached to a form");
          return action.submitForm(form as HTMLFormElement, { trace });
        }
        return action.execute(undefined, { trace });
      };
    }
    return [node];
  }
  const transform = isProjection(value) ? value : undefined;
  const source = transform?.source ?? value;
  if (!isReadable(source))
    throw new TypeError(`${name} expects an ARC readable value`);
  switch (name) {
    case "bind:text":
    case "bind:children":
    case "bind:visible":
      return [
        binding({
          id,
          type:
            name === "bind:text"
              ? "text"
              : name === "bind:children"
                ? "children"
                : "visible",
          sources: [source],
          format: transform?.format,
        }),
      ];
    case "bind:disabled":
      return [
        binding({
          id,
          type: "property",
          name: "disabled",
          sources: [source],
          format: transform?.format,
        }),
      ];
    case "bind:value": {
      const field = source as Writable<string>;
      if (transform || typeof field.set !== "function")
        throw new TypeError("bind:value expects writable string state");
      return [
        binding({ id, type: "property", name: "value", sources: [field] }),
        binding({
          id: `${id}.input`,
          type: "event",
          name: "input",
          sources: [field],
          handler(event, trace) {
            field._trace = trace;
            field.set((event.currentTarget as HTMLInputElement).value);
          },
        }),
      ];
    }
    default:
      const attribute = name.slice("bind:".length);
      if (attribute === "class" || /^(aria|data)-[\w-]+$/.test(attribute)) {
        return [binding({
          id,
          type: "attribute",
          name: attribute,
          sources: [source],
          format(value) {
            const formatted = transform ? transform.format(value) : value;
            return attribute !== "class" && typeof formatted === "boolean"
              ? String(formatted)
              : formatted;
          },
        })];
      }
      throw new Error(`Unknown ARC TSX directive: ${name}`);
  }
}

type LocalState<Initial extends Record<string, unknown>> = {
  [Key in keyof Initial]: Signal<Initial[Key]>;
};

type LocalViewOptions<Initial extends Record<string, unknown>> = Omit<
  ViewOptions, "template" | "bindings" | "setup"
> & {
  state(): Initial;
  template(local: LocalState<Initial>): TemplateElement;
  bindings?: never;
  setup?: never;
};

export function view<Initial extends Record<string, unknown>>(
  options: LocalViewOptions<Initial>,
): View;
export function view(options: ViewOptions): View;
export function view<Initial extends Record<string, unknown>>(
  options: ViewOptions | LocalViewOptions<Initial>,
): View {
  if (!("state" in options)) return buildView(options);

  const { state: initialize, template, ...def } = options;
  function create(scope?: Scope) {
    const local = Object.fromEntries(
      Object.entries(initialize()).map(([key, initial]) => {
        const field = signal({ id: `${def.id}.state.${key}`, initial, scope: "view" });
        return [key, scope ? scope.own(field) : field];
      }),
    ) as LocalState<Initial>;
    const instance = buildView({ ...def, template: () => template(local) });
    instance.dependencies = [...(instance.dependencies ?? []), ...Object.values(local)];
    return instance;
  }

  const graphView = create();
  graphView[instantiateView] = create;
  return graphView;
}

function buildView({
  template,
  setup,
  bindings: declared,
  ...def
}: ViewOptions): View {
  const compiled =
    template && !declared ? compileTemplate(def.id, template()) : undefined;
  if (compiled && (!isTemplate(compiled.root) || compiled.root.tag === Fragment))
    throw new Error("A view template must have one root HTML element");
  const bindings = compiled?.bindings ?? declared ?? [];
  return {
    ...def,
    bindings,
    setup:
      setup ??
      (({ document, bind, mountView }) => {
        const root = renderTemplate(
          compiled?.root ?? template!(),
          document,
          bind,
          compiled && mountView,
        );
        if (root.nodeType !== 1)
          throw new Error("A view template must have one root HTML element");
        return root;
      }),
    kind: "view",
    runtime: "browser",
    dependencies: [
      ...Object.values(def.needs ?? {}),
      ...(compiled?.views ?? []),
      ...bindings,
      ...((def.owned ?? []) as GraphDefinition[]),
    ],
  };
}

function sameItem(previous: unknown, current: unknown): boolean {
  if (Object.is(previous, current)) return true;
  const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype;
  if (!isRecord(previous) || !isRecord(current)) return false;

  const keys = Reflect.ownKeys(previous);
  return (
    keys.length === Reflect.ownKeys(current).length &&
    keys.every(
      (key) =>
        Object.hasOwn(current, key) && Object.is(previous[key], current[key]),
    )
  );
}

function mountList(
  list: KeyedList,
  anchor: Comment,
  id: string,
  renderRow: (template: TemplateElement, scope: Scope) => Node,
) {
  type Row = { item: unknown; element: Element; scope: Scope };
  const emptyKey = Symbol("empty list");
  type Key = string | number | typeof emptyKey;
  let rows = new Map<Key, Row>();

  function remove(row: Row) {
    row.scope.dispose();
    row.element.parentNode?.removeChild(row.element);
  }

  return {
    update(items: readonly unknown[]) {
      const parent = anchor.parentNode;
      if (!parent) return;
      const nextRows = new Map<Key, Row>();
      const created: Row[] = [];
      const entries: [Key, unknown][] = items.map((item) => [list.key(item), item]);
      if (!items.length && list.empty) entries.push([emptyKey, undefined]);

      try {
        for (const [key, item] of entries) {
          if (nextRows.has(key))
            throw new Error(`Duplicate list key ${String(key)} in ${id}`);
          const previous = rows.get(key);
          if (previous && sameItem(previous.item, item)) {
            nextRows.set(key, { ...previous, item });
            continue;
          }
          const scope = new Scope();
          try {
            const template = key === emptyKey ? list.empty! : list.render(item);
            const element = renderRow(template, scope);
            if (element.nodeType !== 1)
              throw new TypeError(`List ${id} requires one HTML element per item`);
            const row = { item, element: element as Element, scope };
            nextRows.set(key, row);
            created.push(row);
          } catch (error) {
            scope.dispose();
            throw error;
          }
        }
      } catch (error) {
        for (const row of created) remove(row);
        throw error;
      }

      for (const [key, row] of rows) {
        if (nextRows.get(key)?.element !== row.element) remove(row);
      }

      let before: Node = anchor;
      for (const { element } of [...nextRows.values()].reverse()) {
        if (element.parentNode !== parent || element.nextSibling !== before)
          parent.insertBefore(element, before);
        before = element;
      }
      rows = nextRows;
    },
    dispose() {
      for (const row of rows.values()) remove(row);
      rows.clear();
    },
  };
}

function observeReads<T>(
  scope: Scope,
  read: () => T,
  apply: (value: T, sources: ReadonlySet<Readable<unknown>>, start: number) => void,
  declared: readonly Readable<unknown>[] = [],
) {
  const subscriptions = new Map<Readable<unknown>, () => void>();
  const update = () => {
    if (scope.disposed) return;
    const start = performance.now();
    const { value, sources } = trackReads(read);
    for (const source of declared) sources.add(source);
    apply(value, sources, start);
    for (const [source, unsubscribe] of subscriptions) {
      if (sources.has(source)) continue;
      unsubscribe();
      subscriptions.delete(source);
    }
    for (const source of sources) {
      if (!subscriptions.has(source)) subscriptions.set(source, source.subscribe(update));
    }
  };
  scope.add(() => {
    for (const unsubscribe of subscriptions.values()) unsubscribe();
    subscriptions.clear();
  });
  update();
}

export function mount(
  def: View,
  target: Element | DocumentFragment,
  options: { telemetry?: WebTelemetry } = {},
) {
  compileArchitecture([def]);
  const scope = new Scope(),
    telemetry = options.telemetry ?? silentTelemetry;
  const boundDisabled = new WeakSet<Element>();
  let root: Node | undefined;
  const attach = (
    b: Binding,
    node: Element | Text | Comment,
    scope: Scope,
    telemetryId = b.id,
  ) => {
    if (b.type === "render" || b.type === "each") {
      if (node.nodeType !== 8)
        throw new TypeError(`Binding ${b.id} requires a comment anchor`);
      const document = node.ownerDocument!;
      const renderContent = (value: TemplateChild, contentScope: Scope) => {
        const compiled = compileTemplate(b.id, value);
        return renderTemplate(compiled.root, document, (binding, child) =>
          attach(binding, child, contentScope, telemetryId),
        );
      };
      const updated = (sources: ReadonlySet<Readable<unknown>>, start: number) =>
        browserEvent(
          telemetry,
          telemetryId,
          "binding.updated",
          [...sources].find((source) => source._trace)?._trace,
          { duration: performance.now() - start, data: { view: def.id } },
        );

      if (b.type === "each") {
        const list = b.list;
        if (!list) throw new TypeError(`Binding ${b.id} requires a list`);
        const instance = scope.own(mountList(list, node as Comment, b.id, renderContent));
        const source = list.source;
        observeReads(scope, isReadable(source) ? () => source.get() : source,
          (items, sources, start) => {
            instance.update(items ?? []);
            updated(sources, start);
          },
          b.sources,
        );
        return;
      }

      const block = b.block;
      if (!block) throw new TypeError(`Binding ${b.id} requires a render block`);
      let rendered: Node[] = [];
      let contentScope: Scope | undefined;
      scope.add(() => {
        contentScope?.dispose();
        for (const child of rendered) child.parentNode?.removeChild(child);
      });
      observeReads(scope, block.template, (value, sources, start) => {
        const parent = node.parentNode;
        if (!parent) return;
        const nextScope = new Scope();
        let content: Node;
        try {
          content = renderContent(value, nextScope);
        } catch (error) {
          nextScope.dispose();
          throw error;
        }
        contentScope?.dispose();
        contentScope = nextScope;
        const next = content.nodeType === 11 ? Array.from(content.childNodes) : [content];
        for (const previous of rendered) {
          if (previous.parentNode === parent) parent.removeChild(previous);
        }
        parent.insertBefore(content, node);
        rendered = next;
        updated(sources, start);
      });
      return;
    }
    if (node.nodeType !== 1 && b.type !== "text")
      throw new TypeError(`Binding ${b.id} requires an HTML element`);
    const element = node as Element;
    if (b.readAttribute) {
      observeReads(scope, b.readAttribute, (value, sources, start) => {
        const name = b.name!;
        if (value == null || (value === false && !/^(aria|data)-/.test(name)))
          element.removeAttribute(name);
        else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
          element.setAttribute(name, String(value));
        else throw new TypeError(`Expected a primitive TSX attribute: ${name}`);
        browserEvent(
          telemetry, telemetryId, "binding.updated",
          [...sources].find((source) => source._trace)?._trace,
          { duration: performance.now() - start, data: { view: def.id } },
        );
      });
      return;
    }
    if (b.type === "event") {
      let updateSubmitButtons: (() => void) | undefined;
      if (b.submitRunning && element.localName === "form") {
        const running = b.submitRunning;
        const form = element as HTMLFormElement;
        const disabled = new Set<HTMLInputElement | HTMLButtonElement>();
        function restore() {
          for (const button of disabled) button.disabled = false;
          disabled.clear();
        }
        updateSubmitButtons = () => {
          if (!running.get()) {
            restore();
            return;
          }
          const buttons = new Set([
            ...Array.from(form.elements ?? []),
            ...form.querySelectorAll("button, input[type=submit], input[type=image]"),
          ]);
          for (const element of buttons) {
            const button = element as HTMLInputElement | HTMLButtonElement;
            const type = button.getAttribute("type")?.toLowerCase();
            const submit = button.localName === "button"
              ? type !== "button" && type !== "reset"
              : button.localName === "input" && (type === "submit" || type === "image");
            if (submit && !button.disabled && !boundDisabled.has(button) &&
                (button.form === form || (!button.form && !button.hasAttribute("form")))) {
              button.disabled = true;
              disabled.add(button);
            }
          }
        };
        scope.add(restore);
        scope.add(running.subscribe(updateSubmitButtons));
        updateSubmitButtons();
      }
      const listener = (event: Event) => {
        const trace = { traceId: identity() };
        browserEvent(telemetry, telemetryId, "binding.event", trace);
        try {
          const result =
            typeof b.handler === "function"
              ? b.handler(event, trace)
              : b.handler?.execute(b.input, { trace });
          updateSubmitButtons?.();
          if (result && typeof (result as any).catch === "function")
            void (result as Promise<unknown>).catch((error) =>
              browserEvent(telemetry, telemetryId, "binding.error", trace, {
                data: { message: String(error) },
              }),
            );
        } catch (error) {
          browserEvent(telemetry, telemetryId, "binding.error", trace, {
            data: { message: String(error) },
          });
        }
      };
      element.addEventListener(b.name ?? "click", listener);
      scope.add(() => element.removeEventListener(b.name ?? "click", listener));
      return;
    }
    if (b.type === "property" && b.name === "disabled") boundDisabled.add(element);
    const update = () => {
      if (scope.disposed) return;
      const start = performance.now(),
        values = b.sources.map((s) => s.get()),
        value = b.format ? b.format(...values) : values[0];
      if (b.type === "text") node.textContent = String(value ?? "");
      else if (b.type === "children") {
        const content = renderTemplate(value, element.ownerDocument);
        element.replaceChildren(content);
      } else if (b.type === "property") (element as any)[b.name!] = value;
      else if (b.type === "attribute") {
        if (value === false || value == null) element.removeAttribute(b.name!);
        else element.setAttribute(b.name!, String(value));
      } else (element as HTMLElement).hidden = !value;
      browserEvent(
        telemetry,
        telemetryId,
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
    const instance = def[instantiateView]?.(scope) ?? def;
    root = instance.setup({
      document: target.ownerDocument,
      scope,
      bind(binding, node) {
        if (!instance.bindings.includes(binding))
          throw new Error(`Undeclared binding: ${binding.id}`);
        attach(binding, node, scope);
      },
      mountView(child, container) {
        scope.own(mount(child, container, options));
      },
    });
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
