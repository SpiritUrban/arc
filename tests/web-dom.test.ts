import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  state,
  binding,
  view,
  mount,
  tick,
} from "../framework/src/web/index.ts";
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
