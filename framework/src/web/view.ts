import { compileArchitecture, type GraphDefinition } from "../neutral/graph.js";
import type { OperationContract } from "../neutral/contracts.js";
import type {
  FieldKeyMutationOptions,
  Mutation,
  MutationFieldKey,
  MutationKeyField,
  NamedMutationOptions,
} from "../fullstack/client.js";
import {
  browserEvent,
  identity,
  silentTelemetry,
  type TraceToken,
  type WebTelemetry,
} from "../neutral/protocol.js";
import type { Action, FormSubmission } from "./async.js";
import {
  registerFormChecked,
  registerFormRadio,
  registerFormValue,
  registerFormValues,
} from "./form-value.js";
import {
  attributeReader,
  boundChild,
  elementBindings,
  Fragment,
  isKeyedList,
  isNestedView,
  isRenderBlock,
  isTemplate,
  jsx,
  render,
  renderTemplate,
  type ExpressionReferences,
  type KeyedList,
  type RenderBlock,
  type TemplateChild,
  type TemplateElement,
} from "./jsx-runtime.js";
import {
  derive,
  graphNeeds,
  Scope,
  signal,
  trackReads,
  withWriteTrace,
  type Computed,
  type DerivedFrom,
  type DerivedValues,
  type GraphNeeds,
  type Readable,
  type Signal,
  type Writable,
} from "./reactive.js";

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

function reactiveAttributeName(name: string): string | undefined {
  if (
    name === "key" || name.toLowerCase() === "srcdoc" ||
    name.startsWith("bind:") || /^on/i.test(name)
  )
    return;
  if (name === "className") return "class";
  if (name === "htmlFor") return "for";
  return name;
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
  references?: ExpressionReferences;
  name?: string;
  format?: (...values: any[]) => unknown;
  readAttribute?: () => unknown;
  submitRunning?: Readable<boolean>;
  formValue?: Writable<string>;
  formChecked?: Writable<boolean>;
  formRadio?: Writable<string>;
  formValues?: Writable<string[]>;
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
  const handler = def.handler as unknown as GraphDefinition | undefined;
  const action = handler?.id ? handler : undefined;
  const dependencies = (sources: readonly Readable<unknown>[]) =>
    action ? [...sources, action] : sources;
  const relations = (sources: readonly Readable<unknown>[]) => {
    const links = sources.map((to) => ({ to, kind: "BINDS" as const }));
    return action ? [...links, { to: action, kind: "TRIGGERS" as const }] : links;
  };
  function graphSources() {
    if (!def.references) return def.sources;
    const inferred = def.references().filter((value): value is Readable<unknown> =>
      isReadable(value) && typeof value.id === "string" && typeof value.kind === "string",
    );
    return [...new Set([...def.sources, ...inferred])];
  }
  function graphReferences() {
    return (def.references?.() ?? []).filter((value): value is GraphDefinition =>
      value !== null && typeof value === "object" &&
      typeof (value as GraphDefinition).id === "string" &&
      typeof (value as GraphDefinition).kind === "string" &&
      !isReadable(value),
    );
  }
  const node: Binding = {
    ...def,
    kind: "binding",
    runtime: "browser",
    dependencies: [...dependencies(def.sources), ...graphReferences()],
    relations: [
      ...relations(def.sources),
      ...graphReferences().map((reference) => ({ to: reference, kind: "DEPENDS_ON" as const })),
    ],
  };
  if (!def.references) return node;
  return {
    ...node,
    get dependencies() {
      return [...dependencies(graphSources()), ...graphReferences()];
    },
    get relations() {
      return [
        ...relations(graphSources()),
        ...graphReferences().map((reference) => ({ to: reference, kind: "DEPENDS_ON" as const })),
      ];
    },
  };
}
export interface View extends GraphDefinition {
  (): TemplateElement;
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
  "kind" | "runtime" | "dependencies" | "needs" | "owned" | "setup" | "bindings"
> & {
  needs?: GraphNeeds;
  owned?: OwnedNodes;
} & (
    | { setup: View["setup"]; bindings: readonly Binding[]; template?: never }
    | {
        template: TemplateElement | (() => TemplateElement);
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
    if (typeof child === "function" && !isReadable(child))
      child = render(child);
    if (isTemplate(child) && isNestedView(child.tag)) {
      views.add(child.tag);
      return child.tag;
    }
    if (isRenderBlock(child)) {
      const region = binding({
        id: `${id}.dom.${path}.render`,
        type: "render",
        sources: [],
        references: child.references,
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
        references: child.references,
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
    const radioValue = child.tag === "input" && attributes.type === "radio"
      ? attributes.value
      : undefined;
    const checkboxValue = child.tag === "input" && attributes.type === "checkbox"
      ? attributes.value
      : undefined;
    const multipleSelect = child.tag === "select" &&
      (attributes.multiple === true || attributes.multiple === "" ||
        attributes.multiple === "multiple");
    for (const [name, value] of Object.entries(attributes)) {
      if (name === "onSubmit") {
        delete attributes[name];
        if (value == null) continue;
        if (child.tag === Fragment)
          throw new Error(`Attach onSubmit to an HTML element in ${id}`);
        attached.push(...directive(`${id}.dom.${path}.on:submit`, "on:submit", value));
        continue;
      }
      if (/^on[A-Z]/.test(name)) {
        delete attributes[name];
        if (value == null) continue;
        if (child.tag === Fragment)
          throw new Error(`Attach ${name} to an HTML element in ${id}`);
        const event = name === "onDoubleClick"
          ? "dblclick"
          : name.slice(2).toLowerCase();
        attached.push(
          ...directive(`${id}.dom.${path}.on:${event}`, `on:${event}`, value),
        );
        continue;
      }
      const attribute = attributeReader(value);
      if (attribute) {
        delete attributes[name];
        attached.push(binding({
          id: `${id}.dom.${path}.${name}`,
          type: ["value", "checked", "selected", "disabled"].includes(name)
            ? "property"
            : "attribute",
          name:
            name === "className" ? "class" : name === "htmlFor" ? "for" : name,
          sources: [],
          references: attribute.references,
          readAttribute: attribute.read,
        }));
        continue;
      }
      const reactiveName = reactiveAttributeName(name);
      if (isReadable(value) && reactiveName) {
        const property = ["value", "checked", "selected", "disabled"].includes(name);
        attached.push(binding({
          id: `${id}.dom.${path}.${name}`,
          type: property ? "property" : "attribute",
          name: reactiveName,
          sources: [value],
        }));
        continue;
      }
      if (!name.startsWith("bind:") && !name.startsWith("on:")) continue;
      delete attributes[name];
      if (name === "bind:value" && value === undefined) continue;
      if (child.tag === Fragment)
        throw new Error(`Attach ${name} to an HTML element in ${id}`);
      if (
        name === "bind:checked" &&
        (child.tag !== "input" || attributes.type !== "checkbox")
      )
        throw new TypeError("bind:checked requires an input[type=checkbox]");
      attached.push(
        ...directive(`${id}.dom.${path}.${name}`, name, value, {
          radio: child.tag === "input" && attributes.type === "radio",
          checkbox: child.tag === "input" && attributes.type === "checkbox",
          checkboxValue,
          multiple: multipleSelect,
          radioValue,
        }),
      );
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

function directive(
  id: string,
  name: string,
  value: unknown,
  options: {
    radio?: boolean;
    checkbox?: boolean;
    multiple?: boolean;
    radioValue?: unknown;
    checkboxValue?: unknown;
  } = {},
): Binding[] {
  if (name.startsWith("on:")) {
    const event = name.slice(3);
    const form = value as FormSubmission | undefined;
    const submission = event === "submit" && form?.kind === "form-submission" ? form : undefined;
    const action = submission?.action ?? (value as Action<void, unknown> | undefined);
    const isAction = action?.kind === "action" && typeof action.execute === "function";
    if (event && typeof value === "function" && !isAction) {
      const handler = value as EventHandler;
      return [binding({
        id,
        type: "event",
        name: event,
        sources: [],
        handler(domEvent, trace) {
          if (event === "submit") domEvent.preventDefault();
          return withWriteTrace(trace, () => handler(domEvent, {
            set(state, next) {
              state._trace = trace;
              state.set(next);
            },
          }));
        },
      })];
    }
    if (!event || !isAction)
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
        if (submission || action.submitForm) {
          const form = event.currentTarget;
          if ((form as Element | null)?.localName !== "form")
            throw new TypeError("A named-field action must be attached to a form");
          const element = form as HTMLFormElement;
          return submission
            ? submission.submit(element, { trace })
            : action.submitForm!(element, { trace });
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
    case "bind:checked": {
      const field = source as Writable<boolean>;
      if (transform || typeof field.set !== "function")
        throw new TypeError("bind:checked expects writable boolean state");
      return [
        binding({
          id,
          type: "property",
          name: "checked",
          sources: [field],
          formChecked: field,
        }),
        binding({
          id: `${id}.change`,
          type: "event",
          name: "change",
          sources: [field],
          handler(event, trace) {
            field._trace = trace;
            field.set((event.currentTarget as HTMLInputElement).checked);
          },
        }),
      ];
    }
    case "bind:value": {
      if (transform || typeof (source as { set?: unknown }).set !== "function")
        throw new TypeError("bind:value expects writable string state");
      if (options.checkbox) {
        const field = source as Writable<string[]>;
        if (!Array.isArray(field.get()))
          throw new TypeError("Checkbox group bind:value expects string array state");
        if (typeof options.checkboxValue !== "string")
          throw new TypeError("Checkbox group bind:value requires a static string value");
        const checkboxValue = options.checkboxValue;
        return [
          binding({
            id,
            type: "property",
            name: "checked",
            sources: [field],
            format: (current) => (current as readonly string[]).includes(checkboxValue),
            formValues: field,
          }),
          binding({
            id: `${id}.change`,
            type: "event",
            name: "change",
            sources: [field],
            handler(event, trace) {
              const input = event.currentTarget as HTMLInputElement;
              const selected = new Set(field.get());
              if (input.checked) selected.add(checkboxValue);
              else selected.delete(checkboxValue);
              field._trace = trace;
              field.set([...selected]);
            },
          }),
        ];
      }
      if (options.multiple) {
        const field = source as Writable<string[]>;
        if (!Array.isArray(field.get()))
          throw new TypeError("select[multiple] bind:value expects string array state");
        return [
          binding({
            id,
            type: "property",
            name: "selectedValues",
            sources: [field],
            formValues: field,
          }),
          binding({
            id: `${id}.change`,
            type: "event",
            name: "change",
            sources: [field],
            handler(event, trace) {
              const select = event.currentTarget as HTMLSelectElement;
              field._trace = trace;
              field.set(Array.from(select.selectedOptions, (option) => option.value));
            },
          }),
        ];
      }
      const field = source as Writable<string>;
      if (typeof field.get() !== "string")
        throw new TypeError("bind:value expects string state");
      if (options.radio) {
        if (typeof options.radioValue !== "string")
          throw new TypeError("Radio bind:value requires a static string value");
        const radioValue = options.radioValue;
        return [
          binding({
            id,
            type: "property",
            name: "checked",
            sources: [field],
            format: (current) => current === radioValue,
            formRadio: field,
          }),
          binding({
            id: `${id}.change`,
            type: "event",
            name: "change",
            sources: [field],
            handler(event, trace) {
              const input = event.currentTarget as HTMLInputElement;
              if (!input.checked) return;
              field._trace = trace;
              field.set(input.value);
            },
          }),
        ];
      }
      return [
        binding({ id, type: "property", name: "value", sources: [field], formValue: field }),
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

type LocalViewBase<Initial extends Record<string, unknown>> = Omit<
  ViewOptions, "template" | "bindings" | "setup"
> & {
  template(local: LocalState<Initial>, context: Pick<PageContext, "derive" | "own">): TemplateElement;
  bindings?: never;
  setup?: never;
};
type LocalViewOptions<Initial extends Record<string, unknown>> = LocalViewBase<Initial> & {
  state(): Initial;
};
type PrimitiveInitial = string | number | boolean | bigint | null | undefined;
type ScalarLocalViewOptions<Initial extends PrimitiveInitial> = Omit<
  ViewOptions, "template" | "bindings" | "setup"
> & {
  state: Initial | (() => Initial);
  template(value: Signal<Initial>, context: Pick<PageContext, "derive" | "own">): TemplateElement;
  bindings?: never;
  setup?: never;
};
type StaticViewState<Initial extends Record<string, PrimitiveInitial>> = {
  [Key in keyof Initial]: Initial[Key];
};
type StaticLocalViewOptions<Initial extends Record<string, PrimitiveInitial>> =
  LocalViewBase<Initial> & { state: StaticViewState<Initial> };

export function view<Initial extends PrimitiveInitial>(
  options: ScalarLocalViewOptions<Initial>,
): View;
export function view<Initial extends Record<string, unknown>>(
  options: LocalViewOptions<Initial>,
): View;
export function view<Initial extends Record<string, PrimitiveInitial>>(
  options: StaticLocalViewOptions<Initial>,
): View;
export function view(options: ViewOptions): View;
export function view<Initial extends Record<string, unknown>>(
  options:
    | ViewOptions
    | ScalarLocalViewOptions<PrimitiveInitial>
    | LocalViewOptions<Initial>
    | StaticLocalViewOptions<any>,
): View {
  if (!("state" in options)) return buildView(options);

  const { state: initialize, template, ...def } = options;
  return scopedView(def, ({ local, derive, own }) => {
    const initial = typeof initialize === "function" ? initialize() : initialize;
    if (initial === null || typeof initial !== "object")
      return (template as ScalarLocalViewOptions<PrimitiveInitial>["template"])(
        local(initial as PrimitiveInitial, "value"),
        { derive, own },
      );
    const fields = Object.fromEntries(
      Object.entries(initial).map(([key, value]) => [key, local(value, key)]),
    ) as LocalState<Initial>;
    return (template as LocalViewBase<Initial>["template"])(fields, { derive, own });
  });
}

/** Switch between declared child views while keeping their parent view mounted. */
export function outlet(id: string, current: Readable<View>, choices: readonly View[]): View {
  return view({
    id,
    needs: Object.fromEntries(choices.map((child, index) => [`child${index}`, child])),
    template: () => jsx("div", {
      style: "display:contents",
      children: render(() => current.get(), () => [current]),
    }),
  });
}

type OwnedNode = NonNullable<View["owned"]>[number];
type OwnedNodes = OwnedNode | readonly OwnedNode[];
function ownedNodes(owned?: OwnedNodes): OwnedNode[] {
  if (owned === undefined) return [];
  return Array.isArray(owned) ? owned : [owned as OwnedNode];
}

export interface PageContext<Param extends string = string> {
  params: Readonly<Record<Param, string>>;
  local<T>(initial: T, name?: string): Signal<T>;
  own<T extends OwnedNode>(node: T): T;
  /** Create a derived value owned by this view instance. */
  derive<const From extends DerivedFrom, T>(
    name: string, from: From, compute: (...values: DerivedValues<From>) => T,
  ): Computed<T>;
  query<T extends OwnedNode, Contract>(
    client: { query(contract: Contract, options?: { params?: Readonly<Record<Param, string>> }): T },
    contract: Contract,
  ): T;
  query<T extends OwnedNode, Args extends unknown[]>(
    client: { query(...args: Args): T },
    ...args: Args
  ): T;
  mutation<C extends OperationContract, Field extends MutationKeyField<NoInfer<C>>>(
    client: {
      mutation<Contract extends OperationContract, K extends MutationKeyField<NoInfer<Contract>>>(
        contract: Contract, options: FieldKeyMutationOptions<NoInfer<Contract>, K>,
      ): Mutation<Contract, never, MutationFieldKey<Contract, K>>;
    },
    contract: C,
    options: FieldKeyMutationOptions<NoInfer<C>, Field>,
  ): Mutation<C, never, MutationFieldKey<C, Field>>;
  mutation<C extends OperationContract, Key extends string | number = string | number>(
    client: {
      mutation<Contract extends OperationContract, K extends string | number>(
        contract: Contract, options?: NamedMutationOptions<Contract, K>,
      ): Mutation<Contract, never, K>;
    },
    contract: C,
    options?: NamedMutationOptions<NoInfer<C>, Key>,
  ): Mutation<C, never, Key>;
}

export interface PageLayoutContext<Param extends string = string> extends PageContext<Param> {
  children: View;
  route: string;
}

export function pageView(
  id: string,
  template: (context: PageContext) => TemplateElement,
  params: Readonly<Record<string, string>> = {},
): View {
  function withRouteParams<Options extends { params?: unknown }>(contract: unknown, options?: Options) {
    const operation = contract as Partial<OperationContract> | undefined;
    const fields = operation?.kind === "operation" ? operation.input?.json?.properties : undefined;
    const routeInput = options?.params ?? (fields
      ? Object.fromEntries(Object.entries(params).filter(([name]) => Object.hasOwn(fields, name)))
      : params);
    return {
      ...options,
      params: routeInput as NonNullable<Options["params"]>,
    };
  }
  return scopedView({ id }, ({ local, derive, own }) => template({
    params,
    local,
    derive,
    own,
    query: ((client: { query(...args: any[]): OwnedNode }, ...args: unknown[]) =>
      own(client.query(args[0], withRouteParams(args[0], args[1] as { params?: unknown } | undefined)))
    ) as PageContext["query"],
    mutation: <
      Contract extends OperationContract,
      Options extends { params?: unknown },
      Result extends OwnedNode,
    >(
      client: { mutation(contract: Contract, options?: Options): Result },
      contract: Contract,
      options?: Options,
    ) => own(client.mutation(contract, withRouteParams(contract, options) as Options)),
  }));
}

type LocalFactory = <T>(initial: T, name?: string) => Signal<T>;

function scopedView(
  def: Omit<LocalViewOptions<Record<string, unknown>>, "state" | "template">,
  template: (context: Pick<PageContext, "local" | "derive" | "own">) => TemplateElement,
): View {
  function create(scope?: Scope) {
    const fields = new Map<string, GraphDefinition>();
    const owned = ownedNodes(def.owned);
    const derivedNames = new Set<string>();
    let building = true;
    const local: LocalFactory = (initial, name = String(fields.size)) => {
      if (!building) throw new Error(`Declare local state while building ${def.id}`);
      if (fields.has(name)) throw new Error(`Duplicate local state ${name} in ${def.id}`);
      const field = signal({ id: `${def.id}.state.${name}`, initial, scope: "view" });
      fields.set(name, scope ? scope.own(field) : field);
      return field;
    };
    const own: PageContext["own"] = (node) => {
      if (!building) throw new Error(`Declare owned resources while building ${def.id}`);
      if (!owned.includes(node)) {
        node.metadata = { ...node.metadata, scope: "view" };
        owned.push(node);
      }
      return node;
    };
    const deriveLocal: PageContext["derive"] = (name, from, compute) => {
      if (!building) throw new Error(`Declare derived values while building ${def.id}`);
      if (derivedNames.has(name)) throw new Error(`Duplicate derived value ${name} in ${def.id}`);
      const node = own(derive(`${def.id}.derived.${name}`, from, compute));
      derivedNames.add(name);
      return node;
    };
    try {
      const instance = buildView({
        ...def, owned, template: () => template({ local, derive: deriveLocal, own }),
      });
      instance.dependencies = [...(instance.dependencies ?? []), ...fields.values()];
      return instance;
    } catch (error) {
      if (scope) for (const node of owned) scope.own(node);
      throw error;
    } finally {
      building = false;
    }
  }

  const graphView = create();
  graphView[instantiateView] = create;
  return graphView;
}

function buildView({
  template,
  setup,
  bindings: declared,
  needs,
  owned: ownedOption,
  ...def
}: ViewOptions): View {
  const owned = ownedNodes(ownedOption);
  const templateRoot = typeof template === "function" ? template() : template;
  const compiled =
    templateRoot && !declared ? compileTemplate(def.id, templateRoot) : undefined;
  if (compiled && (!isTemplate(compiled.root) || compiled.root.tag === Fragment))
    throw new Error("A view template must have one root HTML element");
  const bindings = compiled?.bindings ?? declared ?? [];
  return asView({
    ...def,
    owned,
    bindings,
    setup:
      setup ??
      (({ document, bind, mountView }) => {
        const root = renderTemplate(
          compiled?.root ?? templateRoot!,
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
    needs: Object.fromEntries(graphNeeds(needs).map((node) => [node.id, node])),
    dependencies: [
      ...graphNeeds(needs),
      ...(compiled?.views ?? []),
      ...bindings,
      ...owned,
    ],
  });
}

function asView(definition: Omit<View, "call">): View {
  const node = (() => jsx(node, {})) as View;
  Object.assign(node, definition);
  return node;
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
          (view, fragment) => contentScope.own(mount(view, fragment, { telemetry })),
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
      if (b.name === "disabled") boundDisabled.add(element);
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
          const handler = b.handler;
          const result = handler && "execute" in handler
            ? handler.execute(b.input, { trace })
            : handler?.(event, trace);
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
    if (b.formValue) scope.add(registerFormValue(element, b.formValue));
    if (b.formChecked) scope.add(registerFormChecked(element, b.formChecked));
    if (b.formRadio) scope.add(registerFormRadio(element, b.formRadio));
    if (b.formValues) scope.add(registerFormValues(element, b.formValues));
    const update = () => {
      if (scope.disposed) return;
      const start = performance.now(),
        values = b.sources.map((s) => s.get()),
        value = b.format ? b.format(...values) : values[0];
      if (b.type === "text") node.textContent = String(value ?? "");
      else if (b.type === "children") {
        const content = renderTemplate(value, element.ownerDocument);
        element.replaceChildren(content);
      } else if (b.type === "property" && b.name === "selectedValues") {
        const selected = new Set(value as readonly string[]);
        for (const option of (element as HTMLSelectElement).options)
          option.selected = selected.has(option.value);
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
    const instance = def[instantiateView]?.(scope) ?? def;
    const owned = instance.owned ?? [];
    for (const item of owned) scope.own(item);
    for (const item of owned) {
      if ("activate" in item && typeof item.activate === "function")
        item.activate(telemetry);
    }
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
