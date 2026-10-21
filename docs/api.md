# Довідник API

[← Зміст](README.md)

Усі наведені експорти доступні з `@arc/framework`. Це довідник поточної версії, а не специфікація всіх ідей із початкового обговорення.

## Схеми

| Виклик                               | Що приймає                                                |
| ------------------------------------ | --------------------------------------------------------- |
| `s.string({ min?, max?, format? })`  | Рядок; min/max — довжина, format — `'uuid'` або `'email'` |
| `s.uuid()`                           | UUID за regex реалізації                                  |
| `s.email()`                          | Email за спрощеним regex реалізації                       |
| `s.number({ min?, max?, integer? })` | Скінченне число, необов’язкові межі та цілочисельність    |
| `s.int({ min?, max? })`              | Скінченне ціле число                                      |
| `s.boolean()`                        | `true` або `false`                                        |
| `s.literal(value)`                   | Одне фіксоване значення string, number або boolean        |
| `s.array(item)` або `item.array()`   | Масив елементів за схемою item                            |
| `s.object({ field: schema })`        | Об’єкт із заданими полями; невідомі поля відхиляються     |
| `schema.optional()`                  | Значення за схемою або `undefined`                        |

Ті самі конструктори, крім скорочень `uuid`, `email`, `int`, також експортуються окремо як `string`, `number`, `boolean`, `literal`, `array`, `object`.

Кожна схема надає:

```ts
schema.parse(value); // перевірене значення або ValidationError
schema.parse(value, "$.item"); // явний шлях для повідомлення про помилку
schema.sample(); // детермінований приклад
schema.json; // опис JSON Schema
```

`Infer<typeof schema>` виводить TypeScript-тип. `ValidationError.issues` містить масив повідомлень зі шляхами полів. Об’єкт збирає помилки відомих полів; невідоме поле може завершити перевірку раніше.

Валідація сама не перетворює `'42'` на `42`. Числові та boolean query-параметри частково приводить HTTP-адаптер. Відсутні optional-поля не потрапляють у перевірений об’єкт.

`sample()` не є random/fuzz генератором. Необов’язкові поля об’єкта пропускаються, масив має один елемент. Для звичайних підтриманих схем це зручний стартовий input; довільні поєднання обмежень або власна `Schema` можуть вимагати власного генератора. Для schemas наразі немає union, nullable, enum, default, transform, recursive schemas або обмежень довжини масиву.

## operation

```ts
operation({
  id: "feature.action",
  input: InputSchema,
  output: OutputSchema,
  needs: { repository }, // типово {}
  errors: { NOT_FOUND: 404 }, // типово {}
  effects: ["storage.read"], // необов’язкові метадані
  estimateMs: 5, // необов’язкова оцінка автора
  async run({ input, repository, signal }) {
    // Поверніть ok(...) або error(...).
  },
});
```

Обов’язкові поля: `id`, `input`, `output`, `run`. ID має бути непорожнім і унікальним між operations та resources. Ключі `input`, `signal`, `request`, `__proto__`, `constructor`, `prototype` зарезервовані й заборонені як імена в `needs`.

```ts
ok(value); // { ok: true, value }
error("NOT_FOUND"); // { ok: false, error: 'NOT_FOUND', details: undefined }
error("NOT_FOUND", { id });
```

JSON-серіалізація пропускає `details`, коли воно `undefined`. `Result<T, E>` — дискримінований union за полем `ok`; стандартний тип E — `string`.

`Fault(code, status = 500, details?)` є exception із HTTP-статусом. `Fault` часто використовується capability чи адаптером. Для бізнес-відмов операції перевагу має `error` із записом у `errors`.

## resource / capability

```ts
resource({
  id: "storage",
  scope: "application", // або 'request'; типово 'application'
  needs: {},
  effects: ["storage.read"],
  estimateMs: 2,
  async open(ctx) {
    return value;
  },
  async close(value) {
    // Звільнення отриманого значення.
  },
});
```

Обов’язкові поля: `id`, `open`. `open` отримує оголошені залежності; request-ресурсу додатково передаються `request` та `signal`, які можуть бути `undefined`. Application-ресурси відкриваються без request-контексту.

`capability` — точний alias `resource`. Немає реєстрації за класом чи пошуку залежності за рядком: `needs` містить самі об’єкти визначень.

## module та application

```ts
const feature = module({
  id: "feature",
  operations: [action],
  resources: [backgroundResource],
  routes: [http.get("/feature", action)],
});

const app = application({
  modules: [feature],
  operations: [],
  resources: [],
  routes: [],
  traceLimit: 500,
});
```

`module` лише групує визначення. `id` модуля не додає URL-префікс і не префіксує ID операцій. Явний `resources` доречний, коли ресурс треба відкрити з lifecycle застосунку навіть без залежності від нього в операціях. У module немає вкладеного `modules`.

Основні методи Application:

| Метод / поле                                    | Поведінка                                                       |
| ----------------------------------------------- | --------------------------------------------------------------- |
| `await app.compile()`                           | Перевірка графа, плани, відкриття application-ресурсів          |
| `await app.execute(id, input, options?)`        | Result або rejected Promise у разі exception                    |
| `app.graph()`                                   | Поточний IR; використовуйте після compile                       |
| `app.metrics()`                                 | Метрики операцій із збережених traces                           |
| `app.traces`                                    | Буфер traces                                                    |
| `app.operations`, `app.resources`, `app.routes` | Зібрані визначення; після compile включають знайдені залежності |
| `await app.close()`                             | Очікування активних операцій і звільнення application-ресурсів  |

`execute` приймає options `{ request?: Request, signal?: AbortSignal, overrides?: Map }`. Request та signal незалежні: для програмного адаптера передайте `signal: request.signal` явно, якщо потрібно. Input перевіряється завжди.

`compile({ overrides })` і `execute(..., { overrides })` — низькорівневі засоби тестової підміни за об’єктом ресурсу. Для звичайних тестів використовуйте `test(operation)`, який узгоджує обидві підміни та прибирає зайві гілки залежностей.

Повторний `compile` уже скомпільованого застосунку нічого не змінює. Не використовуйте його як hot reload або спосіб пізно змінити overrides.

## HTTP-маршрути

```ts
http.get("/tasks/:id", getTask);
http.post("/tasks", createTask, { status: 201 });
http.put("/tasks/:id", replaceTask);
http.patch("/tasks/:id", updateTask);
http.delete("/tasks/:id", deleteTask);
```

Ці функції повертають Route; самі сервер не запускають. Успішний status типовий 200. Поточний handler використовує JSON-відповіді; для операцій видалення зручніше повертати JSON-підтвердження зі статусом 200, ніж порожній 204.

Для HTTP input має бути об’єктом. Адаптер збирає його як:

```ts
{ ...jsonBody, ...query, ...pathParams }
```

Отже query перекриває body, а pathParams перекриває обидва. Не використовуйте конфліктні імена для різних джерел без явного наміру.

| Джерело   | Правила поточної версії                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------- |
| Path      | `:name` — один непорожній сегмент; значення декодується як рядок                                     |
| Query     | Верхньорівневі number/integer приводяться через Number; boolean — лише `'true'`/`'false'`            |
| JSON body | Для POST/PUT/PATCH та інших методів, крім GET/HEAD/DELETE; потрібен `application/json` і JSON-об’єкт |
| DELETE    | Body не читається handler-ом; input передавайте через path/query                                     |

Повторювані query-ключі не стають масивом, залишається останнє значення. Вкладені об’єкти й масиви із query не декодуються. Path-числа автоматично не приводяться, тому числовий ID краще передавати як string і обробляти явно. Заголовки input-схема автоматично не бачить; їх читає request-capability.

Маршрути з меншою кількістю параметрів перевіряються першими. Wildcard, regex-параметри, optional-сегменти, довільні middleware та автоматичний CORS/OPTIONS не реалізовані. `/openapi.json` є вбудованим GET-маршрутом; не використовуйте його під власний endpoint.

### Програмний запуск HTTP

```ts
import { handler, serve, closeServer } from "@arc/framework";

await app.compile();
const server = await serve(handler(app), {
  port: 3000,
  host: "127.0.0.1",
  maxBodyBytes: 1024 * 1024,
});

// Під час завершення:
await closeServer(server);
await app.close();
```

`handler(app)` створює функцію `(Request) => Promise<Response>`. Вона придатна і для HTTP-тестів без сокетів. `serve` повертає Node `Server`. Типовий ліміт body — 1 MiB. Bridge буферизує запит та відповідь; streaming і WebSocket не підтримуються. Правила Host описані в [початку роботи](getting-started.md#налаштування).

### Відповіді й помилки

| Випадок                                                   | HTTP-відповідь                                     |
| --------------------------------------------------------- | -------------------------------------------------- |
| `ok(value)`                                               | `value`, status маршруту                           |
| Оголошений `error(code, details)`                         | Result із `ok: false`, status з `operation.errors` |
| Невалідний input                                          | 400 `VALIDATION_ERROR`, details із повідомленнями  |
| Некоректне JSON body або не об’єкт                        | 400 `INVALID_JSON`                                 |
| Непідтриманий Content-Type                                | 415 `UNSUPPORTED_MEDIA_TYPE`                       |
| Невідомий маршрут                                         | 404 `NOT_FOUND`                                    |
| `throw new Fault(code, status, details)`                  | Заданий status і код                               |
| Невалідний успішний output                                | 500 `INVALID_OUTPUT`                               |
| Інший exception, невалідний Result або неоголошений error | 500 `INTERNAL_ERROR`                               |

Помилки Node bridge до виклику handler можуть мати простішу відповідь: перевищення ліміту body дає 413 `{"error":"BODY_TOO_LARGE"}`, заборонений Host — порожній 403.

`openapi(app)` повертає специфікацію програмно; `GET /openapi.json` — через handler. Схеми успішних відповідей і `operation.errors` беруться з визначень. Auth-capabilities не перетворюються автоматично на security schemes чи додаткові 401-відповіді OpenAPI.

## JSON-RPC

```ts
import { rpc, serve, closeServer } from "@arc/framework";

await app.compile();
const rpcServer = await serve(rpc(app, { "tasks.get": getTask }), {
  port: 3200,
});

// Перед app.close():
await closeServer(rpcServer);
```

Запит:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tasks.get",
  "params": { "id": "00000000-0000-4000-8000-000000000001" }
}
```

RPC-ім’я може відрізнятися від ID операції. Операція має бути зареєстрована в Application до compile; сам `rpc` не реєструє її. HTTP-заголовки передаються до request-capabilities.

Реалізовано одиночні виклики: parse error `-32700`, invalid request `-32600`, method not found `-32601`, invalid params `-32602`, internal error `-32603`. Оголошена бізнес-помилка повертається з RPC-кодом `-32000`. Успішно виконана notification без `id` отримує порожній HTTP 204. Повної підтримки batch та всіх протокольних edge cases немає.

## Черга в пам’яті

```ts
import { queue } from "@arc/framework";

const worker = queue(app, createTask, { concurrency: 4, capacity: 1000 });
const result = await worker.enqueue({ title: "Queued task" });
console.log(worker.metrics());
await worker.close();
```

Application перед цим має бути скомпільований, а операція — зареєстрована. `concurrency` обмежує активні jobs, `capacity` — jobs в очікуванні, без активних. При переповненні або після close `enqueue` повертає rejected Promise.

`enqueue` завершується Result операції або відхиляється при exception. Обробляйте Promise кожної job. `close()` припиняє приймання нових jobs і чекає завершення вже прийнятих, включно з pending.

`metrics()` повертає `{ pending, running, completed, failed }`. `completed` рахує resolved Result, зокрема бізнес-відмови; `failed` включає бізнес-відмови та exceptions. Тому ці поля не є взаємовиключними.

Черга не має persistence, retries, delivery guarantees чи передачі request-контексту. Queue та schedule не додають власних вузлів до Architecture IR і не мають окремих панелей керування у Stand.

## Планувальник

```ts
import { schedule } from "@arc/framework";

const timer = schedule(app, createTask, {
  everyMs: 60_000,
  input: () => ({ title: "Periodic task" }),
  onError: (reason) => console.error(reason),
});

await timer.close();
```

Це interval, а не cron-expression. Перший виклик — після першого інтервалу. Якщо попередній ще працює, tick пропускається. Пропущені ticks не накопичуються. `close` очищує timer і чекає активний виклик. `onError` отримує бізнес-Result з `ok: false` або exception; сам callback не повинен кидати помилку.

## Локальний типізований client

```ts
import { client } from "@arc/framework";

const api = client(app, { create: createTask, get: getTask });
const result = await api.create({ title: "Typed call" });
```

Input/output виводяться із схем переданих операцій. Клієнт викликає `app.execute` локально, без HTTP, RPC або автоматичного Request. Він не є згенерованим frontend SDK, не реєструє операції й не обходить runtime-валидацію.

## Test harness та telemetry

`test(operation).provide(resource, fake).run(input)` описано з прикладами в [розділі тестування](testing-and-stand.md).

`traceContext.getStore()` усередині виклику повертає `{ traceId, operation }` або `undefined` поза ним. `Trace` та `Span` експортуються як TypeScript-інтерфейси. Всі тривалості — мілісекунди. Формат і межі метрик описані в [архітектурі](architecture.md#граф-та-спостереження).
