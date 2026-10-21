# Тести та ARC Stand 0.2

[← Зміст](README.md)

## Перевірки

```sh
npm test                    # unit/integration
npm run test:lifecycle      # окремо lifecycle/concurrency
npm run typecheck           # включно з negative type tests
npm run build               # framework/dist ESM + declarations, root dist
npm run test:distribution   # pack → clean offline install → plain node / CLI
npm run benchmark:scheduler
node --conditions=arc-source --import tsx --test docs/examples/tasks.test.ts
```

`tests/contracts.types.ts` містить @ts-expect-error перевірки неправильних business codes, details і ctx.call input. `lifecycle.test.ts` перевіряє pure compile, concurrent start/close, rollback, shared nested scope, dependency-ready scheduling, abort і adapter drain. `stand-tools.test.ts` — corpus, metrics, explicit effects, specs, load та SSE.

## Тест операції та HTTP

```ts
const result = await testOperation(getTask)
  .provide(tasksRepository, fakeRepository)
  .run({ id: "00000000-0000-4000-8000-000000000001" });
```

Harness виконує compile → start → execute → close. Підмінюйте той самий resource object із needs; fake має відповідати всьому типу ресурсу. Input/output/errors перевіряються. Для Request/signal можна передати другий аргумент run. Для stateful integration створюйте новий Application фабрикою.

```ts
await app.compile();
await app.start();
try {
  const response = await handler(app)(
    new Request("http://localhost/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Check ARC" }),
    }),
  );
} finally {
  await app.close();
}
```

Це HTTP-handler тест без socket. Node bridge/Host/body limits перевіряються окремими network integration tests.

## Stand та input corpus

`npm run dev` запускає application :3000 і Stand :3100. У графі є ingress, operation, resource, effect, queue, worker і schedule. Клік відкриває contract/plan/analysis. Вузли активності підсвічуються SSE-подіями; polling metrics/traces лишається fallback.

Generate valid/invalid та список cases використовують schema-aware corpus: валідний sample, min/max і сусідні boundary values, empty/unicode, malformed UUID/email, missing/optional fields і wrong types. Обирайте конкретний case зі списку. Генерація детермінована; random/property-based fuzzing ще попереду. Корпус може включати повторні бізнес-дані: schema-valid email не гарантує відсутність такого email у DB.

## Три режими виконання

| mode        | Що вимірює                                                 |
| ----------- | ---------------------------------------------------------- |
| `operation` | In-process app.execute; без HTTP mapping/network           |
| `http`      | Локальний HTTP handler із Request/Response; без socket     |
| `network`   | Реальний fetch до налаштованого server-side networkBaseUrl |

CLI налаштовує networkBaseUrl на application loopback порт. Браузер не може передати довільний target URL. Network-вимір також може ділити процес/host із генератором — це не зовнішній deployment benchmark.

Authorization у Stand передається Request-capabilities в усіх режимах. Operation mode повертає Result, HTTP/network — `{status, body}`. Виклики змінюють реальний стан поточного development application.

## Load API

`POST /api/load` приймає operation/input/authorization/mode та:

| Поле          | Значення                                               |
| ------------- | ------------------------------------------------------ |
| `inputMode`   | fixed або generated: циклічний обхід валідного corpus  |
| `count`       | Максимальна кількість запитів; API cap 10000           |
| `durationMs`  | Максимальне вікно видачі запитів; API cap 30000 ms     |
| `concurrency` | Worker cap, 1–100                                      |
| `targetRps`   | Цільова частота видачі; без значення — без pacing      |
| `rampUpMs`    | Лінійне зростання scheduled rate від нуля до targetRps |
| `timeoutMs`   | AbortSignal timeout одного виклику                     |

Завершення настає за першим із count/duration, після чого генератор чекає in-flight роботу. Duration не обриває вже початі виклики. Timeout вимагає cooperative cancellation від коду; JS не переривається примусово. Target RPS — offered-load план, не гарантований observed throughput; concurrency може обмежити видачу.

Результат: completed, outcomes, durationMs, observed RPS, p50/p95/p99, peakConcurrent, targetRps, saturation flag. Saturation — проста евристика: observed RPS < 80% target при досягненні concurrency cap. Це не вимір насичення DB/CPU.

`POST /api/breaking` додає initialRps (типово 10), maxRps (1000), steps (1–12, типово 6), constraints:

```json
{
  "maxErrorRate": 0.01,
  "maxFaultRate": 0.01,
  "p95Ms": 1000,
  "maxCancelledRate": 0,
  "failOnSaturation": true
}
```

Алгоритм підвищує/знижує RPS, а після появи passing/failing межі робить bisection. Повертає rounds із причинами та lastPassingRps/firstFailingRps. Без достатніх samples чи failing round не можна стверджувати, що межу знайдено. Поля constraints доступні через API; UI дає основні error-rate/p95 налаштування. Висновок стосується конкретного режиму, input і запуску.

## Метрики та traces

Lifetime: totalCalls, ok, business_error, fault, cancelled; поточні active та peakConcurrent. Rolling: RPM за 60 s, RPS за 1 s, p50/p95/p99 за metricsWindowMs (типово 60 s). Вони не залежать від traceLimit. Nested operation calls рахуються окремо; root duration охоплює cleanup. Input-validation failures належать до fault, очікувані errors — business_error.

Bounded trace buffer використовується тільки для debugging. Один root trace містить nested operation, resource-open та instrumented-effect spans із parentId. Деталі methods/SQL без явної instrumentation автоматично не перехоплюються. Ingress-specific network timings не є окремими compiler-derived estimates.

## Failure injection

Для application-ресурсу оголосіть `instrument: ['asyncMethod']` і оберіть effect-вузол `resourceId.asyncMethod` у Stand. Сам application-resource вузол не створює ілюзії перехоплення довільних методів.

Ін’єкції: latencyMs, errorRate, timeoutMs, unavailable. Timeout симулює очікування і Fault 504 **до фактичного виклику методу**, unavailable/errorRate — Fault 503. Це не реальне закриття DB connection; disconnect моделюється unavailable boundary. Оригінальний об’єкт не monkey-patched; внутрішні this.method виклики не перехоплюються. Для request-resource ін’єкція застосовується до open, для operation — до її execution span.

Ін’єкція спільна для поточного Application і впливає також на його звичайні HTTP-виклики. Clear знімає налаштування. Signal скасовує injected delays.

## Reusable Stand tests

Scratch tests лишаються в пам’яті. Export JSON, import та Save to disk працюють зі стабільним versioned spec:

```json
{
  "version": 1,
  "name": "create record",
  "operation": "records.create",
  "input": { "name": "demo" },
  "expected": {
    "ok": true,
    "value": {
      "id": { "$match": "uuid" },
      "createdAt": { "$match": "iso-date" }
    }
  },
  "setup": "seed",
  "reset": "reset"
}
```

Objects match subset fields, arrays — точну довжину й елементи. Доступні `$match: 'any'|'uuid'|'iso-date'|'type'` (для type ще поле type). Ігноруйте nondeterministic поля, пропускаючи їх у expected, або застосуйте matcher. Literal значення порівнюються через Object.is, не JSON.stringify.

`stand(app, { testFile, hooks: { seed, reset }, networkBaseUrl })` налаштовує persistence і server-owned hooks. Setup виконується перед тестом, reset — у finally. Невідомий hook є помилкою. Hooks не виводяться автоматично з repository та не передаються кодом із браузера.

CLI зберігає файл `.arc/stand-tests.json` при явному Save to disk. Scratch tests самі не пишуться на диск. До versioned spec можна явно додати request.authorization/request.headers через Include authorization; типовий export і live payload прибирають request context. Для export із credentials використовуйте `?includeContext=1`. Файл і контекст можуть містити локальні credentials — зберігайте їх тільки з явним наміром. `.arc/` виключено з Git.

Для запуску поза Stand: `runTestSpec(app, spec, hooks)`. Spec — JSON; TypeScript test generation та YAML parser не реалізовані.

## API Stand та SSE

GET: `/api/graph`, `/api/live`, `/api/events`, `/api/test/export`.

POST JSON:

| Шлях                         | Payload                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `/api/generate`              | operation                                                                                 |
| `/api/run`                   | operation, input, mode?, authorization?                                                   |
| `/api/load`, `/api/breaking` | параметри вище                                                                            |
| `/api/fault`                 | node + injection settings або clear: true                                                 |
| `/api/test/save`             | operation/input/expected/name?, includeContext?, authorization?, setup?, reset?, persist? |
| `/api/test/import`           | tests: spec[], persist?                                                                   |
| `/api/test/persist`          | {}                                                                                        |
| `/api/test/run`              | {}                                                                                        |

POST потребує application/json та same Origin, якщо Origin передано. SSE — operation.started/finished, resource.opened/closed, queue.state, worker.state, schedule.triggered, metrics.updated, graph.updated; без replay. Stand є локальним development tool, без production auth/RBAC або історичного сховища.
