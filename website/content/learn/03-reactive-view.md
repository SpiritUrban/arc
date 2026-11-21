# 03. State, derive і живий DOM

ARC Web не потребує ARC Server. Оголосіть local state, derived value та дію. ARC створить вузли DOM-прив’язок за директивами в TSX.

## Counter view

Збережіть приклад у `counter.tsx`. Налаштування JSX runtime ARC наведено в [посібнику про шаблони](../../../docs/web/views.md).

```tsx
import { state, derive, action, project, view } from "@arc/framework/web";

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
export const Counter = view({
  id: "lesson.counter",
  template: () => (
    <section>
      <p>Подвоєне значення: <strong>{project(doubled, (value) => String(value))}</strong></p>
      <button type="button" on:click={increment}>Додати</button>
    </section>
  ),
});
```

Це feature module для browser entry, не файл для запуску напряму в Node. Приклад entry у репозиторії: examples/web-counter/browser.ts.

## Mount у browser entry

```ts
import { webApplication } from "@arc/framework/web";
import { Counter } from "./counter.tsx";
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

`project` форматує значення прямо в прив’язці. Джерело видно в графі. Окремий `derive` підходить для обчислення, яке можна використати в кількох місцях.

State writes групуються в microtask batch. Спочатку scheduler обчислює affected derived nodes, потім bindings. TSX-шаблон повторно не виконується. Для кількох synchronous writes можна використати batch; після await потрібен окремий batch.

## Результат уроку

Ви знаєте різницю між client-owned state, derive та DOM binding. Далі проведемо явну boundary до server operation.
