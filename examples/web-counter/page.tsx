import { state, derive, action, view } from "@arc/framework/web";

// state зберігає змінне значення. Ідентифікатор вузла видно в графі Stand.
export const count = state({ id: "counter.value", initial: 0 });

// derive перераховує результат, коли змінюється значення з масиву from.
export const doubled = derive({
  id: "counter.doubled",
  from: count,
  compute: (n) => n * 2,
});

// needs оголошує в графі, що дія працює зі станом лічильника.
const increment = action({
  id: "counter.increment",
  needs: count,
  run() {
    count.update((n) => n + 1);
  },
});

// ARC оновлює обидва реактивні значення прямо в тексті.
export const Counter = view({
  id: "counter.page",
  template: () => (
    <main style="font:24px system-ui;padding:40px">
      <h1>ARC Web — local counter</h1>
      <p>
        {count} · doubled {doubled}
      </p>
      <button type="button" on:click={increment}>
        Increment
      </button>
    </main>
  ),
});
