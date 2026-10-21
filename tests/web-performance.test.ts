import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  state,
  derive,
  action,
  binding,
  view,
  mount,
  tick,
} from "../framework/src/web/index.ts";
test("1000 actual DOM bindings update only three; 100 action writes propagate one derived DAG batch", async () => {
  const source = state({ id: "s", initial: 0 }),
    other = state({ id: "o", initial: 0 });
  let updates = 0,
    recompute = 0;
  const a = derive({
      id: "a",
      from: [source],
      compute: (n) => {
        recompute++;
        return n + 1;
      },
    }),
    b = derive({
      id: "b",
      from: [source],
      compute: (n) => {
        recompute++;
        return n * 2;
      },
    }),
    c = derive({
      id: "c",
      from: [a, b],
      compute: (a, b) => {
        recompute++;
        return a + b;
      },
    });
  const bindings = Array.from({ length: 1000 }, (_, i) =>
    binding({
      id: "binding." + i,
      type: "text",
      sources: [i < 3 ? source : other],
    }),
  );
  const page = view({
    id: "perf",
    bindings,
    setup({ document, bind }) {
      const root = document.createElement("div");
      for (const binding of bindings) {
        const element = document.createElement("span");
        bind(binding, element);
        root.append(element);
      }
      return root;
    },
  });
  const { document } = parseHTML('<div id="app"></div>');
  const instance = mount(
    page,
    document.querySelector("#app")! as unknown as Element,
    {
      telemetry: {
        emit(e) {
          if (e.type === "binding.updated") updates++;
        },
      },
    },
  );
  updates = 0;
  const mutate = action({
    id: "mutate",
    run() {
      for (let i = 1; i <= 100; i++) source.set(i);
    },
  });
  await mutate.execute(undefined);
  await tick();
  assert.equal(updates, 3);
  assert.equal(recompute, 6);
  assert.equal(c.get(), 301);
  instance.unmount();
  assert.equal(source._listeners.size, 0);
  assert.equal(other._listeners.size, 0);
  mutate.dispose();
  c.dispose();
  b.dispose();
  a.dispose();
  source.dispose();
  other.dispose();
});
