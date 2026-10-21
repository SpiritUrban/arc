import { state, derive, action, binding, view } from "@arc/framework/web";
export const count = state({ id: "counter.value", initial: 0 });
export const doubled = derive({
  id: "counter.doubled",
  from: [count],
  compute: (n) => n * 2,
});
const increment = action({
  id: "counter.increment",
  needs: { count },
  run() {
    count.update((n) => n + 1);
  },
});
const text = binding({
  id: "counter.label",
  type: "text",
  sources: [count, doubled],
  format: (count, double) => `${count} · doubled ${double}`,
});
const click = binding({
  id: "counter.click",
  type: "event",
  sources: [],
  handler: increment,
});
export const Counter = view({
  id: "counter.page",
  bindings: [text, click],
  setup({ document, bind }) {
    const main = document.createElement("main");
    main.style.cssText = "font:24px system-ui;padding:40px";
    const heading = document.createElement("h1");
    heading.textContent = "ARC Web — local counter";
    const label = document.createElement("p"),
      button = document.createElement("button");
    button.textContent = "Increment";
    bind(text, label);
    bind(click, button);
    main.append(heading, label, button);
    return main;
  },
});
