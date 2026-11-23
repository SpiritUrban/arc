import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { jsx } from "@arc/framework/web/jsx-runtime";
import { compileArchitecture } from "@arc/framework/core";
import {
  state,
  signal,
  action,
  binding,
  each,
  project,
  render,
  startWeb,
  view,
  mount,
  tick,
  webResource,
} from "../framework/src/web/index.ts";

test("JSX references add resource dependencies without running the expression", async () => {
  const { document } = parseHTML('<div id="app"></div>');
  const target = document.querySelector("#app")!;
  let loads = 0;
  let reads = 0;
  const resource = webResource({
    id: "inferred-resource",
    callable: true,
    async load() {
      loads++;
      return "ready";
    },
  });
  const page = view({
    id: "inferred-page",
    template: () => jsx("p", {
      children: render(() => {
        reads++;
        return resource().data ?? "loading";
      }, () => [resource]),
    }),
  });
  const graph = compileArchitecture([page]);
  assert.ok(graph.edges.some((edge) =>
    edge.from === resource.id && edge.to.endsWith(".render") && edge.kind === "BINDS",
  ));
  assert.equal(reads, 0);
  assert.equal(loads, 0);
  const app = startWeb(page, target);
  assert.equal(loads, 1);
  await tick();
  assert.equal(target.textContent, "ready");
  app.dispose();
});

test("view-local state has a stable graph ID and a fresh value per mount", async () => {
  const { document, window } = parseHTML('<div id="app"></div>');
  const target = document.querySelector("#app")!;
  const page = view({
    id: "search-page",
    state: () => ({ search: "" }),
    template: ({ search }) => jsx("section", {
      children: [
        jsx("input", { "bind:value": search }),
        jsx("output", { children: search }),
      ],
    }),
  });
  const graph = compileArchitecture([page]);
  assert.ok(graph.edges.some((edge) =>
    edge.kind === "BINDS" && edge.from === "search-page.state.search",
  ));

  const first = mount(page, target);
  const second = mount(page, target);
  const [firstInput, secondInput] = target.querySelectorAll("input");
  firstInput.value = "first";
  firstInput.dispatchEvent(new window.Event("input"));
  await tick();
  assert.deepEqual(
    Array.from(target.querySelectorAll("output"), (node) => node.textContent),
    ["first", ""],
  );
  first.unmount();
  secondInput.value = "second";
  secondInput.dispatchEvent(new window.Event("input"));
  await tick();
  const third = mount(page, target);
  assert.deepEqual(
    Array.from(target.querySelectorAll("output"), (node) => node.textContent),
    ["second", ""],
  );
  second.unmount();
  third.unmount();
});

test("JSX composition registers, mounts and disposes nested views", async () => {
  const { document } = parseHTML('<div id="app"></div>');
  const target = document.querySelector("#app")!;
  const message = state({ id: "nested.message", initial: "hello" });
  const child = view({
    id: "nested.child",
    template: () => jsx("p", { children: message }),
  });
  const root = view({
    id: "nested.root",
    template: () => jsx("main", { children: child }),
  });

  const graph = compileArchitecture([root]);
  assert.ok(graph.edges.some(({ from, to }) =>
    [from, to].includes(root.id) && [from, to].includes(child.id),
  ));
  const app = startWeb(root, target);
  assert.equal(target.querySelector("main > p")?.textContent, "hello");
  message.set("updated");
  await tick();
  assert.equal(target.textContent, "updated");
  app.dispose();
  assert.equal(target.childNodes.length, 0);
  assert.equal(message._listeners.size, 0);
});

test("render tracks only the active JSX branch and unsubscribes on unmount", async () => {
  const { document } = parseHTML('<div id="app"></div>');
  const target = document.querySelector("#app")!;
  const show = state({ id: "show", initial: false });
  const count = state({ id: "count", initial: 1 });
  const page = view({
    id: "conditional",
    needs: { show, count },
    template: () => jsx("div", {
      children: ["before", render(() => show.get()
        ? [jsx("strong", { children: count.get() }), "!"]
        : null), "after"],
    }),
  });
  const mounted = mount(page, target);
  assert.equal(target.textContent, "beforeafter");
  assert.equal(count._listeners.size, 0);
  show.set(true);
  await tick();
  assert.equal(target.textContent, "before1!after");
  count.set(2);
  await tick();
  assert.equal(target.textContent, "before2!after");
  show.set(false);
  await tick();
  assert.equal(target.textContent, "beforeafter");
  assert.equal(count._listeners.size, 0);
  mounted.unmount();
  assert.equal(show._listeners.size, 0);
});

test("render cleans up onClick and traces writes to callable state", async () => {
  const { document, window } = parseHTML('<div id="app"></div>');
  const target = document.querySelector("#app")!;
  const row = signal({ id: "row", initial: "first" });
  const selected = signal({ id: "selected-row", initial: "" });
  const page = view({
    id: "row-events",
    template: () => jsx("div", {
      children: render(() => {
        const id = row();
        return jsx("button", { children: id, onClick: () => selected.set(id) });
      }),
    }),
  });
  const mounted = mount(page, target);
  const first = target.querySelector("button")!;
  row.set("second");
  await tick();
  first.dispatchEvent(new window.Event("click"));
  assert.equal(selected.get(), "");
  const second = target.querySelector("button")!;
  second.dispatchEvent(new window.Event("click"));
  assert.equal(selected(), "second");
  assert.ok(selected._trace?.traceId);
  mounted.unmount();
  selected.set("");
  second.dispatchEvent(new window.Event("click"));
  assert.equal(selected.get(), "");
});
test("view setup once, fine-grained bindings and listener/subscription cleanup", async () => {
  const { document } = parseHTML('<div id="app"></div>');
  const count = state({ id: "count", initial: 0 }),
    other = state({ id: "other", initial: 0 });
  let setups = 0,
    updated = 0;
  const label = binding({ id: "label", type: "text", sources: [count] });
  const event = binding({
    id: "click",
    type: "event",
    sources: [],
    handler: () => count.update((v) => v + 1),
  });
  const hidden = binding({
    id: "hidden",
    type: "visible",
    sources: [count],
    format: (v) => v > 0,
  });
  const title = binding({
    id: "title",
    type: "attribute",
    name: "title",
    sources: [other],
  });
  const page = view({
    id: "page",
    bindings: [label, event, hidden, title],
    setup({ document, bind }) {
      setups++;
      const button = document.createElement("button");
      bind(label, button);
      bind(event, button);
      bind(hidden, button);
      bind(title, button);
      return button;
    },
  });
  const mounted = mount(
    page,
    document.querySelector("#app")! as unknown as Element,
    {
      telemetry: {
        emit(e) {
          if (e.type === "binding.updated") updated++;
        },
      },
    },
  );
  const button = document.querySelector("button")!;
  button.dispatchEvent(new document.defaultView!.Event("click"));
  await tick();
  assert.equal(button.textContent, "1");
  assert.equal(setups, 1);
  assert.equal(updated, 5);
  mounted.unmount();
  assert.equal(count._listeners.size, 0);
  button.dispatchEvent(new document.defaultView!.Event("click"));
  assert.equal(count.get(), 1);
  assert.equal(document.querySelector("button"), null);
  count.dispose();
  other.dispose();
});

test("TSX changes the bound list region without rerunning the template", async () => {
  const { document } = parseHTML('<div id="app"></div>');
  const items = state({ id: "items", initial: ["<first>"] });
  const rows = binding({
    id: "rows",
    type: "children",
    sources: [items],
    format: (labels: string[]) =>
      labels.map((label) => jsx("li", {
        children: [label, jsx("input", { value: label, "bind:value": undefined })],
      })),
  });
  let renders = 0;
  const page = view({
    id: "list.page",
    bindings: [rows],
    template() {
      renders++;
      return jsx("main", {
        children: jsx("ul", { bind: rows }),
      });
    },
  });
  const target = document.querySelector("#app")!;
  const instance = mount(page, target as unknown as Element);
  const list = target.querySelector("ul")!;
  assert.equal(list.querySelector("li")!.textContent, "<first>");
  assert.equal(list.querySelector("input")!.value, "<first>");
  assert.equal(list.querySelector("input")!.hasAttribute("bind:value"), false);
  assert.equal(list.querySelector("first"), null);
  items.set(["second", "third"]);
  await tick();
  assert.equal(target.querySelector("ul"), list);
  assert.deepEqual(
    Array.from(list.querySelectorAll("li"), (row) => row.textContent),
    ["second", "third"],
  );
  assert.deepEqual(Array.from(list.querySelectorAll("input"), (input) => input.value), ["second", "third"]);
  assert.equal(renders, 1);
  instance.unmount();
  assert.equal(items._listeners.size, 0);
  assert.equal(target.firstChild, null);
  items.dispose();
});

test("reactive TSX text updates in place and releases subscriptions on unmount", async () => {
  const { document } = parseHTML('<div id="app"></div>');
  const count = state({ id: "text.count", initial: 0 });
  const page = view({
    id: "text.page",
    template: () => jsx("p", {
      children: ["Кількість: ", count, jsx("strong", { children: project(count, (n) => n * 2) })],
    }),
  });
  const target = document.querySelector("#app")!;
  const instance = mount(page, target as unknown as Element);
  const paragraph = target.querySelector("p")!;
  const label = paragraph.firstChild;
  const value = label!.nextSibling;
  const strong = paragraph.querySelector("strong")!;
  const doubled = strong.firstChild;
  assert.equal(paragraph.textContent, "Кількість: 00");
  assert.equal(value?.nodeType, 3);
  assert.equal(doubled?.nodeType, 3);
  count.set(3);
  await tick();
  assert.equal(paragraph.textContent, "Кількість: 36");
  assert.equal(paragraph.firstChild, label);
  assert.equal(label!.nextSibling, value);
  assert.equal(strong.firstChild, doubled);
  instance.unmount();
  assert.equal(count._listeners.size, 0);
  count.dispose();
});

test("keyed JSX lists retain unchanged rows across additions, edits and reordering", async () => {
  const { document } = parseHTML('<div id="app"></div>');
  const items = state({
    id: "list.items",
    initial: [{ id: 1, label: "First" }, { id: 2, label: "Second" }],
  });
  const page = view({
    id: "keyed.page",
    template: () => jsx("ul", {
      children: each(items, {
        key: (item) => item.id,
        render: (item) => jsx("li", {
          children: [item.label, jsx("input", { value: item.label })],
        }),
      }),
    }),
  });
  const { edges } = compileArchitecture([page]);
  assert.ok(edges.some((edge) =>
    edge.from === items.id && edge.kind === "BINDS" && edge.to.endsWith(".each"),
  ));
  const target = document.querySelector("#app")!;
  const mounted = mount(page, target as unknown as Element);
  const [first, second] = target.querySelectorAll("li");
  first.querySelector("input")!.value = "Local edit";

  items.set([{ id: 1, label: "First" }, { id: 3, label: "Third" }, { id: 2, label: "Second" }]);
  await tick();
  assert.deepEqual(Array.from(target.querySelectorAll("li"), (row) => row.textContent), ["First", "Third", "Second"]);
  assert.equal(target.querySelectorAll("li")[0], first);
  assert.equal(target.querySelectorAll("li")[2], second);
  assert.equal(first.querySelector("input")!.value, "Local edit");

  items.set([{ id: 2, label: "Second" }, { id: 1, label: "Changed" }]);
  await tick();
  const rows = target.querySelectorAll("li");
  assert.deepEqual(Array.from(rows, (row) => row.textContent), ["Second", "Changed"]);
  assert.equal(rows[0], second);
  assert.notEqual(rows[1], first);
  mounted.unmount();
  assert.equal(items._listeners.size, 0);
  items.dispose();
});

test("TSX directives declare graph nodes before mount and preserve form behavior", async () => {
  const field = state({ id: "form.field", initial: "before" });
  let complete!: () => void;
  let submissions = 0;
  const save = action({
    id: "form.save",
    needs: { field },
    async run() {
      submissions++;
      await new Promise<void>((resolve) => {
        complete = resolve;
      });
    },
  });
  const page = view({
    id: "form.page",
    template: () =>
      jsx("form", {
        "on:submit": save,
        children: [
          jsx("input", { "bind:value": field }),
          jsx("input", { id: "unbound", value: "initial", "bind:value": undefined }),
          jsx("p", { "bind:text": field }),
          jsx("button", { "bind:disabled": save.running }),
          jsx("button", { id: "auto-submit" }),
          jsx("button", { id: "locked-submit", type: "submit", disabled: true }),
          jsx("button", { id: "regular-button", type: "button" }),
        ],
      }),
  });
  const graph = compileArchitecture([page]);
  assert.equal(graph.nodes.filter((node) => node.kind === "binding").length, 5);
  assert.ok(
    graph.edges.some((edge) => edge.kind === "TRIGGERS" && edge.to === save.id),
  );
  assert.equal(
    graph.edges.filter((edge) => edge.kind === "BINDS" && edge.from === field.id)
      .length,
    3,
  );

  const { document, window } = parseHTML('<div id="app"></div>');
  const target = document.querySelector("#app")!;
  const instance = mount(page, target as unknown as Element);
  const input = target.querySelector("input")!;
  const form = target.querySelector("form")!;
  assert.equal(input.value, "before");
  input.value = "after";
  input.dispatchEvent(new window.Event("input"));
  await tick();
  assert.equal(field.get(), "after");
  assert.equal(target.querySelector("p")!.textContent, "after");
  const unbound = target.querySelector<HTMLInputElement>("#unbound")!;
  assert.equal(unbound.value, "initial");
  assert.equal(unbound.hasAttribute("bind:value"), false);
  unbound.value = "local edit";
  unbound.dispatchEvent(new window.Event("input"));
  assert.equal(field.get(), "after");

  const submit = () =>
    form.dispatchEvent(new window.Event("submit", { cancelable: true }));
  const auto = target.querySelector<HTMLButtonElement>("#auto-submit")!;
  const locked = target.querySelector<HTMLButtonElement>("#locked-submit")!;
  const regular = target.querySelector<HTMLButtonElement>("#regular-button")!;
  assert.equal(submit(), false);
  assert.equal(auto.disabled, true);
  assert.equal(submit(), false);
  await tick();
  assert.equal(submissions, 1);
  assert.equal(target.querySelector("button")!.disabled, true);
  complete();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await tick();
  assert.equal(target.querySelector("button")!.disabled, false);
  assert.equal(auto.disabled, false);
  assert.equal(locked.disabled, true);
  assert.equal(regular.disabled, false);
  instance.unmount();
  assert.equal(field._listeners.size, 0);
  assert.equal(submit(), true);
  save.dispose();
  field.dispose();
});
