import type { Action } from "./async.js";
import type { Readable, Writable } from "./reactive.js";
import type { Binding, EventHandler, Projection, View } from "./view.js";

const templateNode = Symbol("ARC template node");
const childBinding = Symbol("ARC template child binding");
const keyedList = Symbol("ARC template keyed list");
const reactiveBlock = Symbol("ARC reactive JSX block");
const attributeExpression = Symbol("ARC reactive JSX attribute");
export const Fragment = Symbol("ARC template fragment");

type TextValue = string | number | boolean | null | undefined;
type RenderContent = TemplateElement | TextValue | readonly RenderContent[];
export type ExpressionReferences = () => readonly unknown[];
export interface RenderBlock {
  readonly [reactiveBlock]: true;
  readonly template: () => RenderContent;
  readonly references?: ExpressionReferences;
}
interface ChildBinding {
  readonly [childBinding]: Binding;
}
export interface KeyedList {
  readonly [keyedList]: true;
  readonly source: Readable<readonly unknown[] | null | undefined>
    | (() => readonly unknown[] | null | undefined);
  readonly empty?: TemplateElement;
  readonly references?: ExpressionReferences;
  key(item: unknown): string | number;
  render(item: unknown): TemplateElement;
}

export type TemplateChild =
  | TemplateElement
  | TextValue
  | Readable<TextValue>
  | Projection<TextValue>
  | KeyedList
  | RenderBlock
  | View
  | ChildBinding
  | readonly TemplateChild[];

/** Render a reactive collection using one HTML element per stable key. */
export function each<T>(
  source: Readable<readonly T[] | null | undefined> | (() => readonly T[] | null | undefined),
  options: {
    empty?: TemplateElement;
    references?: ExpressionReferences;
    key: (item: T) => string | number;
    render: (item: T) => TemplateElement;
  },
): KeyedList {
  return {
    [keyedList]: true,
    source,
    empty: options.empty,
    references: options.references,
    key: (item) => options.key(item as T),
    render: (item) => options.render(item as T),
  };
}

export function isKeyedList(child: TemplateChild): child is KeyedList {
  return child != null && typeof child === "object" && keyedList in child;
}

/** Reevaluate a JSX region when the ARC values it reads change. */
export function render(
  template: RenderBlock["template"],
  references?: ExpressionReferences,
): RenderBlock {
  return { [reactiveBlock]: true, template, references };
}

export function isRenderBlock(child: TemplateChild): child is RenderBlock {
  return child != null && typeof child === "object" && reactiveBlock in child;
}

export function reactiveAttribute(read: () => unknown, references?: ExpressionReferences) {
  return { [attributeExpression]: { read, references } };
}

export function attributeReader(value: unknown) {
  if (value && typeof value === "object" && attributeExpression in value)
    return (value as ReturnType<typeof reactiveAttribute>)[attributeExpression];
}

export function boundChild(binding: Binding): ChildBinding {
  return { [childBinding]: binding };
}

interface TemplateProps {
  children?: TemplateChild;
  bind?: Binding | readonly Binding[];
  "bind:text"?: Readable<unknown> | Projection<unknown>;
  "bind:children"?: Readable<TemplateChild> | Projection<TemplateChild>;
  "bind:disabled"?: Readable<boolean> | Projection<boolean>;
  "bind:visible"?: Readable<boolean> | Projection<boolean>;
  "bind:value"?: Writable<string>;
  onClick?: (event: MouseEvent) => unknown;
  onSubmit?: Action<void, unknown> | ((event: SubmitEvent) => unknown);
  [event: `on:${string}`]: Action<void, unknown> | EventHandler | undefined;
  [attribute: string]: unknown;
}

export interface TemplateElement {
  readonly [templateNode]: true;
  readonly tag: string | typeof Fragment;
  readonly props: TemplateProps;
}

export namespace JSX {
  export type Element = TemplateElement;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
  export type IntrinsicElements = {
    [Tag in keyof HTMLElementTagNameMap]: TemplateProps;
  };
}

export function jsx<Props extends object>(
  tag: TemplateElement["tag"] | ((props: Props) => TemplateElement),
  props: Props | null,
  _key?: unknown,
): TemplateElement {
  if (typeof tag === "function") return tag((props ?? {}) as Props);
  return { [templateNode]: true, tag, props: props ?? {} };
}

export { jsx as jsxs };

export function isNestedView(child: TemplateChild): child is View {
  return child != null && typeof child === "object" && "kind" in child && child.kind === "view" && "setup" in child;
}

export function isTemplate(child: TemplateChild): child is TemplateElement {
  return child != null && typeof child === "object" && templateNode in child;
}

export function elementBindings(
  bindings: TemplateProps["bind"],
): readonly Binding[] {
  if (!bindings) return [];
  return "kind" in bindings ? [bindings] : bindings;
}

type AttachBinding = (binding: Binding, node: Element | Text | Comment) => void;

export function renderTemplate(
  child: TemplateChild,
  document: Document,
  bind?: AttachBinding,
  mountView?: (view: View, target: DocumentFragment) => void,
): Node {
  if (child == null || typeof child === "boolean")
    return document.createDocumentFragment();
  if (typeof child === "string" || typeof child === "number")
    return document.createTextNode(String(child));
  if (Array.isArray(child)) {
    const fragment = document.createDocumentFragment();
    for (const item of child)
      fragment.appendChild(renderTemplate(item, document, bind, mountView));
    return fragment;
  }
  if (typeof child === "object" && childBinding in child) {
    const binding = child[childBinding];
    if (!bind)
      throw new Error(
        "Reactive JSX children require a statically declared view template",
      );
    if (binding.type === "each" || binding.type === "render") {
      const fragment = document.createDocumentFragment();
      const anchor = document.createComment("");
      fragment.appendChild(anchor);
      bind(binding, anchor);
      return fragment;
    }
    const node = document.createTextNode("");
    bind(binding, node);
    return node;
  }
  if (isNestedView(child)) {
    if (!mountView) throw new Error("Nested views require a static view template");
    const target = document.createDocumentFragment();
    mountView(child, target);
    return target;
  }
  if (!isTemplate(child))
    throw new TypeError("Expected an ARC TSX element or text");
  const {
    tag,
    props: { children, bind: bindings, ...attributes },
  } = child;
  if (tag === Fragment) return renderTemplate(children, document, bind, mountView);
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name.startsWith("bind:") || name.startsWith("on:"))
      throw new Error(`${name} requires a statically declared view element`);
    if (value == null) continue;
    if (/^on/i.test(name) || name.toLowerCase() === "srcdoc")
      throw new TypeError(`Unsupported TSX attribute: ${name}`);
    const attribute =
      name === "className" ? "class" : name === "htmlFor" ? "for" : name;
    if (typeof value === "boolean" && !/^(aria-|data-)/.test(attribute)) {
      if (value) element.setAttribute(attribute, "");
    } else if (["string", "number", "boolean"].includes(typeof value)) {
      element.setAttribute(attribute, String(value));
    } else {
      throw new TypeError(`Expected a primitive TSX attribute: ${name}`);
    }
  }
  element.appendChild(renderTemplate(children, document, bind, mountView));
  if (bindings) {
    if (!bind)
      throw new Error(
        "Attach bindings to the view template, outside dynamic children",
      );
    for (const binding of elementBindings(bindings)) bind(binding, element);
  }
  return element;
}
