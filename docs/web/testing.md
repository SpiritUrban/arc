# Тестування frontend

Web tests не потребують зовнішньої DB чи справжнього API provider. Reactive core перевіряється напряму, DOM — через Linkedom, fullstack — через internalTransport і real localhost HTTP. Це не заміна visual/browser compatibility QA.

## Команди

```sh
npm run test:web       # tests/web-*.test.ts
npm run test:fullstack # transport і browser-build tests навчальних прикладів
node --conditions=arc-source --import tsx --test tests/workspace.test.ts
npm test              # включає і root Workspace integration test
npm run typecheck
npm run typecheck:core
npm run build
npm run benchmark:web
```

test:web сам не включає workspace.test.ts; test:fullstack теж має явний список файлів. Для всього застосунку запускайте npm test. Build root включає .arc/web frontend assets. Stand scratch/reusable server tests описані [окремо](../testing-and-stand.md).

## Reactive unit test

```ts
import assert from "node:assert/strict";
import { state, derive, batch, flush } from "@arc/framework/web";

const quantity = state({ id: "test.quantity", initial: 1 });
const total = derive({
  id: "test.total",
  from: [quantity],
  compute: (n) => n * 25,
});
batch(() => {
  quantity.set(2);
  quantity.set(3);
});
flush();
assert.equal(total.get(), 75);
total.dispose();
quantity.dispose();
```

Додайте counter у compute/observer, якщо перевіряєте кількість recomputations. Не тестуйте лише те, що callback був викликаний: перевіряйте кінцеве значення та відсутність inconsistent observer states. [Реальні unit tests](../../tests/web-reactive.test.ts).

## DOM та lifecycle

Створіть DOM через parseHTML, mount view, змініть state, await tick() і перевірте конкретний binding. Окремо перевірте, що setup count дорівнює одному, unmount прибрав DOM, а listener більше не запускає action. При application-owned state dispose runtime; при standalone mount звільніть application-owned nodes вручну. [DOM test](../../tests/web-dom.test.ts), [scope/abort tests](../../tests/web-async.test.ts).

## Race conditions

Використовуйте керовані deferred promises: почніть load A, змініть input на B, завершіть B перед A. Останнім state має лишитися B навіть якщо loader проігнорував signal. Перевірте signal.aborted, error/cancelled outcome, disposal і late completion. Модель loaders з setTimeout лише приховує важливий ordering; explicit deferred зручніший.

## Root Workspace integration

[tests/workspace.test.ts](../../tests/workspace.test.ts):

1. Створює fresh server application, compile/start.
2. Збирає src/browser.ts через той самий buildWeb, що використовує CLI.
3. Виконує bundle в isolated VM з Linkedom та real HTTP fetch.
4. Створює користувача, вибирає його, створює замовлення і перевіряє суму.
5. Перевіряє duplicate email, escaped user text, search і відсутність чужих orders після selection change.
6. Зіставляє browser action trace з server orders.create, перевіряє teardown.
7. Перевіряє, що browser manifest не містить src/users/index.ts і src/orders/index.ts.

HTTP server та temporary build output закриваються/видаляються у finally. Server createApp створює fresh repository state; browser bundle має власні state instances. Не перевикористовуйте disposed application singleton між tests.

## Вимірювання

[benchmark](../../benchmarks/reactivity.ts) створює 1000 DOM bindings у Linkedom: зміна source зачіпає 3; 100 writes у batch дають 3 updates і по одному scheduled compute кожного affected derived. Timing — synthetic Node/Linkedom measurement, не deployment performance чи порівняння з React/Vue. Тести не доводять відсутність усіх heap leaks: тут перевіряються відписки, listeners, abort та release DOM.
