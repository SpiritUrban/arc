import { parseHTML } from "linkedom";
import {
  state,
  derive,
  batch,
  flush,
  binding,
  view,
  mount,
} from "../framework/src/web/index.ts";
const source = state({ id: "source", initial: 0 }),
  other = state({ id: "other", initial: 0 });
let updates = 0,
  recomputes = 0;
const bindings = Array.from({ length: 1000 }, (_, i) =>
  binding({
    id: "binding." + i,
    type: "text",
    sources: [i < 3 ? source : other],
  }),
);
const page = view({
  id: "benchmark.page",
  bindings,
  setup({ document, bind }) {
    const root = document.createElement("div");
    for (const b of bindings) {
      const span = document.createElement("span");
      bind(b, span);
      root.append(span);
    }
    return root;
  },
});
const { document } = parseHTML('<div id="app"></div>');
const mounted = mount(
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
const left = derive({
    id: "left",
    from: [source],
    compute: (n) => {
      recomputes++;
      return n + 1;
    },
  }),
  right = derive({
    id: "right",
    from: [source],
    compute: (n) => {
      recomputes++;
      return n * 2;
    },
  }),
  total = derive({
    id: "total",
    from: [left, right],
    compute: (a, b) => {
      recomputes++;
      return a + b;
    },
  });
const start = performance.now();
batch(() => {
  for (let i = 1; i <= 100; i++) source.set(i);
});
flush();
const duration = performance.now() - start;
console.log(
  JSON.stringify(
    {
      kind: "Linkedom actual-DOM binding microbenchmark; not real-browser performance or React/Vue comparison",
      bindings: 1000,
      affectedBindings: 3,
      writesInBatch: 100,
      observedBindingUpdates: updates,
      derivedNodes: 3,
      derivedComputationsIncludingInitialization: recomputes,
      derivedComputationsForBatch: recomputes - 3,
      total: total.get(),
      elapsedMs: duration,
    },
    null,
    2,
  ),
);
mounted.unmount();
total.dispose();
left.dispose();
right.dispose();
source.dispose();
other.dispose();
