import { state, action, view } from "@arc/framework/web";

// state зберігає змінне значення. Ідентифікатор вузла видно в графі Stand.
export const count = state({ id: "counter.value", initial: 0 });

// needs оголошує в графі, що дія працює зі станом лічильника.
const increment = action({
  id: "counter.increment",
  needs: count,
  run() {
    count.update((n) => n + 1);
  },
});

// ARC оновлює і пряме значення, і обчислення JSX у відповідь на зміну count.
export const Counter = view({
  id: "counter.page",
  template: (
    <main style="font:24px system-ui;padding:40px">
      <h1>ARC Web — local counter</h1>
      <p>
        {count} · doubled {count() * 2}
      </p>
      <button type="button" onClick={increment}>
        Increment
      </button>
    </main>
  ),
});
