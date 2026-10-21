# Міграція ARC 0.1 → 0.2

[← Зміст](README.md)

Цей розділ описує зміни для наявного застосунку. [Повний аудит](audit/README.md) зберігає причини, результати тестів і benchmark; [API](api.md) описує поточну реалізацію.

## 1. Додайте activation у програмний bootstrap

Було:

```ts
await app.compile();
await app.execute("system.health", {});
```

Стало:

```ts
await app.compile();
try {
  await app.start(); // activate() — рівнозначний alias
  await app.execute("system.health", {});
} finally {
  await app.close();
}
```

`compile()` більше не відкриває ресурси. `start()` потрібен і для операцій без application-ресурсів. Execute до start відхиляється. Повторний compile не виконує recompilation; після close створюйте новий Application. Відкриття зовнішніх клієнтів перенесіть із top-level імпортів у resource.open, інакше CLI graph не може гарантувати offline імпорт вашого entrypoint.

Default-export entrypoint для CLI має лише повертати `application(...)`: CLI сам обирає compile-only для graph/inspect та activation для run/start/stand. Test harness також сам виконує потрібний lifecycle.

## 2. Перевірте package imports і build

```sh
npm install
npm run build
npm run dev
```

За замовчуванням `@arc/framework` експортує compiled ESM `dist/index.js` та declarations. Production JS не потребує tsx:

```sh
ARC_APP=dist/src/app.js node framework/arc.mjs start
```

Development-скрипти монорепозиторію використовують `--conditions=arc-source --import tsx`. Не змішуйте source та compiled copies фреймворку в одному bootstrap: CLI перевіряє Application через instanceof, а схемам також потрібна узгоджена копія класу Schema. Для власного app дотримуйтесь одного public import `@arc/framework` та одного режиму запуску.

Framework source використовує NodeNext `.js` relative imports. Приклад застосунку може лишати `.ts` imports із налаштованим rewriteRelativeImportExtensions. Native TypeScript entrypoint підтримує лише syntax, який уміє прибирати ваша версія Node; production шлях — compiled JS.

## 3. Оголосіть вкладені calls

Для внутрішнього сценарію замініть незалежний app.execute у бізнес-логіці на declared call:

```ts
import { operation, s, ok } from "@arc/framework";

const child = operation({
  id: "numbers.double",
  input: s.object({ value: s.int() }),
  output: s.int(),
  run: ({ input }) => ok(input.value * 2),
});

const parent = operation({
  id: "numbers.calculate",
  input: s.object({ value: s.int() }),
  output: s.int(),
  calls: { double: child },
  async run({ input, call }) {
    return call("double", { value: input.value });
  },
});
```

Child знаходиться транзитивно. Calls мають typed names/input/output, CALLS relation та parent-linked spans. Вони успадковують Request/signal і той самий кеш request-resources. Цикли заборонені. Якщо child повертає business errors, батьківська operation повинна явно оголосити їх або перетворити Result на свій контракт.

## 4. За потреби посильте errors

`errors: { MISSING: 404 }` та глобальний `error('MISSING')` лишилися сумісними. Для typed details використовуйте local fail:

```ts
const checked = operation({
  id: "numbers.checked",
  input: s.object({ value: s.int() }),
  output: s.int(),
  errors: {
    NEGATIVE: { status: 422, details: s.object({ received: s.int() }) },
  },
  run({ input, fail }) {
    return input.value < 0
      ? fail("NEGATIVE", { received: input.value })
      : ok(input.value);
  },
});
```

Невідомий код, відсутні required details або неправильний їхній тип не проходять TypeScript. Runtime також перевіряє contracts. Не стирайте inferred тип широкою анотацією Operation та не використовуйте `as any` для обходу перевірок.

## 5. Перенесіть transports у декларації

```ts
const jobs = queue({ id: "jobs", operation: processJob, concurrency: 4 });
const timer = schedule({
  id: "refresh",
  operation: refresh,
  everyMs: 60_000,
  input: () => ({}),
});
const app = application({ queues: [jobs], schedules: [timer] });
await app.compile();
await app.start();
const result = await app.queues.get("jobs")!.enqueue(jobInput);
```

Це фрагмент конфігурації: processJob, refresh та jobInput визначає ваш application. Queue/schedule operations включаються в graph транзитивно. Input callback schedule виконується тільки runtime. Application.close зупиняє schedules і дренує queues.

Legacy `queue(app, op, options)` та `schedule(app, op, options)` працюють після start і явно додають відсутній transport до IR; operation має вже бути скомпільована. Для offline inspection використовуйте декларації до compile.

## 6. Оновіть інтеграції з IR та telemetry

| Було                           | Стало                                                                  |
| ------------------------------ | ---------------------------------------------------------------------- |
| IR version 1                   | version 2                                                              |
| operation/resource nodes       | Також http-route, queue, worker, schedule, effect                      |
| Нетипізовані dependency edges  | edge.kind із DEPENDS_ON/CALLS/ROUTES_TO/CONSUMES/TRIGGERS              |
| План як масив рівнів           | `{ scheduler: 'dependency-ready', resources: [{ id, dependencies }] }` |
| Один root на кожен direct call | ctx.call ділить root trace і execution scope                           |
| RPM із traces                  | Незалежний metrics accumulator                                         |
| Спільний errors count          | Окремі ok/business_error/fault/cancelled та сумісний errors            |

Не підсумовуйте всі operation totals як HTTP ingress: nested invocations також мають власні metrics. Trace eviction не видаляє metrics. Percentiles — за часовим вікном; lifetime total не є розміром trace buffer.

## 7. Оновіть робочий процес Stand

- Для application-service injection позначте його async methods через instrument та обирайте effect-вузол. Ін’єкція самого application-resource після start не перехоплює його методи.
- HTTP у Stand означає локальний handler; network — справжній fetch. Обидва режими відрізняються від прямого executor benchmark.
- Використовуйте JSON matchers для UUID/time замість очікування точного повторення nondeterministic Result.
- Scratch tests лишаються в пам’яті. Для повторного використання експортуйте JSON або явно збережіть у налаштований testFile. Request credentials включаються тільки за явним вибором.
- Setup/reset — server-owned hooks; вони не генеруються автоматично з repository.

## Перевірка після міграції

```sh
npm run typecheck
npm test
npm run test:lifecycle
node --conditions=arc-source --import tsx --test docs/examples/tasks.test.ts
npm run build
npm run test:distribution
npm run graph
npm run inspect -- orders.create
```

При власному Application замініть operation ID в inspect на його наявний ID. Старі benchmark JSON та audit traces є історичними вимірами, а не очікуваними snapshot-значеннями нового запуску.
