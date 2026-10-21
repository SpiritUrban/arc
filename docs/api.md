# API ARC 0.2

[← Зміст](README.md) · [Міграція](audit/README.md)

Публічні експорти — з `@arc/framework`. Для повних прикладів дивіться [написання коду](writing-code.md) та [архітектуру](architecture.md).

## Contracts

| API                                  | Дані / опції                     |
| ------------------------------------ | -------------------------------- |
| `s.string({ min?, max?, format? })`  | Рядок; format: uuid/email        |
| `s.uuid()`, `s.email()`              | Рядкові формати                  |
| `s.number({ min?, max?, integer? })` | Скінченне число                  |
| `s.int({ min?, max? })`              | Ціле число                       |
| `s.boolean()`                        | Boolean                          |
| `s.literal(value)`                   | Фіксований string/number/boolean |
| `s.array(item)`, `item.array()`      | Масив                            |
| `s.object(shape)`                    | Об’єкт; зайві поля заборонені    |
| `schema.optional()`                  | Значення або undefined; не null  |

`schema.parse(value, path?)`, `schema.sample()`, `schema.json`, `Infer<typeof schema>`, `ValidationError.issues` збережено. Fluent `.min()` немає. `validateSchemaMetadata` перевіряє підтриману структуру без запуску callbacks.

`generateCases(schema)` повертає `{ label, category, value, valid }[]`: sample, boundary, edge, invalid. Для number/string враховує min/max і сусідні значення, для uuid/email — характерні malformed inputs, для object/array — варіації полів/елементів. Validity визначається через parse. Генерація детермінована; random/property-based strategy ще не реалізована. Undefined не має самостійного JSON-представлення; для HTTP використовуйте object contracts.

## operation

```ts
const read = operation({
  id: "items.read",
  input: s.object({ id: s.uuid() }),
  output: s.string(),
  needs: { repository },
  calls: { fallback },
  errors: {
    NOT_FOUND: { status: 404, details: s.object({ id: s.uuid() }) },
    FORBIDDEN: 403,
  },
  estimateMs: 5,
  budgetMs: 50,
  effects: ["storage.read"],
  async run({ input, repository, call, fail, signal }) {
    const value = await repository.find(input.id);
    return value ? ok(value) : fail("NOT_FOUND", { id: input.id });
  },
});
```

Обов’язкові: id/input/output/run. Needs/calls/errors типово порожні. `ctx.call(name, input)` дозволяє лише ключі declared calls і виводить child-контракти. `ctx.fail(code, details?)` виводить union errors; details обов’язкові, коли є schema. Поверніть `ok(value)` або дозволений business error. Старий глобальний `error(code, details?)` лишається для сумісності; для schema-typed details використовуйте fail. Не стирайте тип операції широкою анотацією Operation, якщо потрібні точні inferred codes.

`Result<T,E>`, `OperationResult<O,E>`, `BusinessError<E>`, `ErrorContracts`, `Fail<E>` експортуються. Runtime відхиляє `UNDECLARED_ERROR`, `INVALID_ERROR_DETAILS`, `INVALID_OUTPUT`, `INVALID_RESULT`. `Fault(code, status=500, details?)` — exception для framework/capabilities. Після abort результат не повертається як успіх.

Зарезервовані needs keys: input, signal, request, call, fail, **proto**, constructor, prototype. ID спільні між усіма node kinds.

## resource / capability

```ts
const repository = resource({
  id: "items.repository",
  scope: "application",
  instrument: ["find"],
  open: () => ({
    async find(id: string) {
      return id;
    },
  }),
  close: async (value) => {
    /* close client */
  },
});
```

`capability` є alias resource. Needs задаються так само, як у operation. Application-open отримує dependencies; request-open додатково request/signal. Scope типовий application. Close отримує початкове значення application-ресурсу, а не instrumentation proxy.

`instrument` — явний список **async methods**. TypeScript перевіряє ключі; runtime перевіряє наявність функції. ARC обгортає тільки перелічені методи у proxy, не змінюючи оригінальний об’єкт. Effect-вузол має ID `resourceId.method`; через нього проходять spans та ін’єкції. Не перелічуйте синхронний метод: boundary повертає Promise. Внутрішні `this.otherMethod()` на оригінальному об’єкті не перехоплюються автоматично. Instrumentation діє всередині ARC execution, включно з request-open; startup/поза execution не створюють request spans.

## module / application / lifecycle

```ts
const jobs = queue({
  id: "jobs",
  operation: processJob,
  concurrency: 4,
  capacity: 1000,
});
const timer = schedule({
  id: "daily-check",
  operation: check,
  everyMs: 60_000,
  input: () => ({}),
});
const feature = module({
  id: "feature",
  operations: [read],
  routes: [http.get("/items/:id", read)],
  queues: [jobs],
  schedules: [timer],
});
const app = application({
  modules: [feature],
  traceLimit: 500,
  metricsWindowMs: 60_000,
});
await app.compile();
await app.start();
```

Application/module приймають operations/resources/routes/queues/schedules; application також modules та telemetry settings. Module не створює namespace чи prefix. Транзитивні needs/calls/transport operations реєструються автоматично.

| Метод                                             | Семантика                                       |
| ------------------------------------------------- | ----------------------------------------------- |
| `compile({ overrides? })`                         | Pure compilation, IR v2, plans, analysis        |
| `start()` / `activate()`                          | Активація, idempotent concurrent Promise        |
| `execute(id,input,{request?,signal?,overrides?})` | Новий root context, тільки після start          |
| `graph()`                                         | IR та analysis; без activation                  |
| `metrics()`                                       | Незалежний accumulator                          |
| `close()`                                         | Зупинка adapters, drain, cleanup                |
| `subscribe(listener)`                             | Runtime events; повертає unsubscribe            |
| `queues.get(queueId)`                             | Активний queue runtime із enqueue/metrics/close |

`test(operation).provide(resource,value).run(input, options?)` компілює, запускає й закриває ізольований application. Підмінені гілки не відкриваються. Для низькорівневих overrides задавайте їх при compile, щоб pruning був узгоджений.

## HTTP та OpenAPI

`http.get/post/put/patch/delete(path, operation, { status? })` створюють декларацію маршруту; success status типовий 200. `handler(app)` повертає Web Request/Response-функцію. `serve(handler, { port, host?, maxBodyBytes? })` повертає Node Server. `closeServer(server)` закриває його; application закривається окремо.

HTTP input: `{ ...body, ...query, ...path }`. GET/HEAD/DELETE використовують path/query; POST/PUT/PATCH очікують JSON-об’єкт і application/json. Query number/integer та true/false приводяться за верхньорівневою схемою, path лишається string. Масиви/вкладені об’єкти query не декодуються. При повторі query-ключа лишається останній. Для заголовків використовуйте request-capability. Немає автоматичного CORS, wildcards чи optional segments.

Успішна відповідь — output, business error — Result з status контракту. Невалідний input: 400 VALIDATION_ERROR; JSON: 400 INVALID_JSON; Content-Type: 415; відсутній route: 404; невалідний output/error details або невідомий exception: 500. Fault повертає свій status; cancellation через довільний AbortSignal не має окремого стандартного HTTP-коду в цій версії.

`GET /openapi.json` та `openapi(app)` описують contracts/errors, включно з details schemas і oneOf для спільного error status. Auth-capabilities не генерують security schemes автоматично.

Node bridge: body limit 1 MiB, loopback Host allowlist; request body буферизується, response body передається потоком з backpressure. Це підтримує SSE Stand. Довільна streaming-business-operation не є контрактом operation API. Публічний Host/production ingress потребує адаптації.

## RPC, queue, schedule та client

`rpc(app, { 'public.method': operation })` повертає handler одиночних JSON-RPC 2.0 викликів. Потрібні compile/start і зареєстрована operation. Business errors: -32000; validation: -32602; unknown method: -32601. Повного batch/notification edge-case compliance немає.

Декларативні queue/schedule показано вище. Queue — in-memory, без retries/durability. Capacity обмежує pending; concurrency — активні jobs. Enqueue повертає Result або rejected Promise. Metrics: pending/running/completed/failed; completed включає resolved business errors, failed також включає їх, тому поля перетинаються. Application.close дренує всі прийняті jobs.

Schedule — interval, не cron expression. Перший запуск після інтервалу; overlapping ticks пропускаються. Input callback виконується тільки runtime. `onError` обробляє business Result/exception, callback exception публікується як schedule.error.

Legacy `queue(app, op, options)` та `schedule(app, op, options)` лишаються після start. Вони знаходять declared runtime або приєднують transport до IR, якщо operation вже скомпільована. До start користуйтеся декларативною формою. Значення id за замовчуванням: `queue:${op.id}`, `schedule:${op.id}`.

`client(app, { name: op })` — типізований локальний root-execution client. Це не frontend SDK і не заміна nested ctx.call.

## Telemetry та Stand tools

`traceContext.getStore()` повертає traceId/operation. Trace spans мають id, parentId, node, kind, start/duration ms та status. `app.traces` — bounded debug storage. `app.metrics()` не читає цей буфер.

`MetricsAccumulator(windowMs)` окремо накопичує lifetime counts/outcomes, active/peak, RPM (60 s), RPS (1 s), p50/p95/p99 за windowMs. Percentile samples зберігаються точно в часовому вікні, без ліміту кількості; великий traffic потребує майбутнього histogram/exporter. Вікно percentiles не скорочує RPM-retention.

`runLoad(runner, options)` та `findBreakingPoint(runner, options)` — [load API та обмеження](testing-and-stand.md). `matches`, `runTestSpec`, `StandTestSpec` — reusable JSON specs. `stand(app, { testFile?, hooks?, networkBaseUrl? })` повертає Web handler інструментів. Налаштований testFile завантажується при першому запиті; довільний шлях із браузера не приймається.
