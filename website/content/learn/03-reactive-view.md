# 03. State, derive і живий DOM

ARC Web не потребує ARC Server. Оголосіть local state, derived value та binding; setup view виконається лише раз на mount.

## Counter view

```ts
import { state, derive, action, binding, view } from "@arc/framework/web";

const count = state({ id: "lesson.count", initial: 0 });
const doubled = derive({
  id: "lesson.doubled",
  from: [count],
  compute: (n) => n * 2,
});
const increment = action({
  id: "lesson.increment",
  needs: { count },
  run(_, ctx) {
    ctx.set(count, count.get() + 1);
  },
});
const text = binding({
  id: "lesson.text",
  type: "text",
  sources: [doubled],
  format: (n) => `Подвоєне значення: ${n}`,
});
const click = binding({
  id: "lesson.click",
  type: "event",
  sources: [],
  handler: increment,
});
export const Counter = view({
  id: "lesson.counter",
  bindings: [text, click],
  setup({ document, bind }) {
    const button = document.createElement("button");
    bind(text, button);
    bind(click, button);
    return button;
  },
});
```

Це feature module для browser entry, не файл для запуску напряму в Node. Приклад entry у репозиторії: examples/web-counter/browser.ts.

## Mount у browser entry

```ts
import { webApplication } from "@arc/framework/web";
import { Counter } from "./counter.ts";
const app = webApplication({ nodes: [Counter] });
app.compile();
app.start();
app.mount(Counter, document.querySelector("#app")!);
window.addEventListener("pagehide", () => app.dispose(), { once: true });
```

Для окремого pure-Web application logical composition задається application/module з @arc/framework/core, а web.entry вказує на цей browser entry. Готова configuration: examples/web-counter/app.ts.

## Як поширюється зміна

```text
click → increment → count → doubled → text binding
```

State writes групуються в microtask batch. Спочатку scheduler обчислює affected derived nodes, потім bindings. View setup не запускається заново. Для кількох synchronous writes можна використати batch; після await потрібен окремий batch.

## Результат уроку

Ви знаєте різницю між client-owned state, derive та DOM binding. Далі проведемо явну boundary до server operation.
