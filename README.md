# ARC — Application Runtime Graph Compiler

ARC описує backend як виконуваний граф операцій, контрактів та ресурсів. Фреймворк є окремим workspace-пакетом **`framework/`**, а **`src/`** — самостійний приклад застосунку, який імпортує `@arc/framework`.

Потрібен Node.js **22.18+** (перевірено на 24).

```sh
npm install
npm run dev
```

Застосунок: **http://localhost:3000**. ARC Stand: **http://localhost:3100**. Сервери слухають loopback. Зупинка через Ctrl+C закриває сервери, чекає активні операції та звільняє ресурси.

```text
framework/                @arc/framework — окремий модуль
  src/core.ts             визначення, компілятор, executor, lifecycle, telemetry
  src/schema.ts           типізовані контракти, JSON Schema, генерація input
  src/http.ts             Web Request/Response, Node HTTP, OpenAPI
  src/transports.ts       JSON-RPC, queue, interval scheduler, typed client
  src/stand.ts            API інструментів розробника
  src/stand-ui.ts         вбудований інтерфейс Stand
  src/cli.ts              stand/start/graph/inspect/run
src/
  app.ts                  композиція кореневого застосунку
  users/                  контракти, repository та операції користувачів
  orders/                 замовлення з request-scoped авторизацією
tests/                    тести фреймворку та адаптерів
```

Команди:

```sh
npm start                         # тільки application HTTP
npm run graph                     # Architecture IR у JSON
npm run inspect -- orders.create  # контракт, залежності, execution plan
node framework/arc.mjs run system.health '{}'
npm test
npm run typecheck
npm run build                     # JS і declarations у dist/
```

CLI також доступний як `npx arc stand` після `npm install`. `ARC_APP` задає шлях до default-export застосунку (типово `src/app.ts`), `PORT` і `STAND_PORT` — порти.

Приклад API:

```sh
curl http://localhost:3000/health
curl http://localhost:3000/users
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"Vitaliy","email":"vitaliy@example.com"}'
curl -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer 00000000-0000-4000-8000-000000000001' \
  -d '{"product":"ARC Book","quantity":2}'
```

`GET /openapi.json` повертає OpenAPI 3.1 із тих самих контрактів. Авторизація в прикладі демонстраційна: Bearer містить UUID наявного користувача; це не перевірка JWT. Дані прикладу зберігаються в пам’яті й скидаються при перезапуску.

## Операції та ресурси

```ts
import { application, resource, operation, s, ok, http } from "@arc/framework";

const clock = resource({
  id: "clock",
  scope: "application",
  open: () => ({ now: () => new Date().toISOString() }),
});

const now = operation({
  id: "time.now",
  input: s.object({}),
  output: s.object({ time: s.string() }),
  needs: { clock },
  run: ({ clock }) => ok({ time: clock.now() }),
});

const app = application({
  operations: [now],
  routes: [http.get("/time", now)],
});
await app.compile();
await app.execute("time.now", {});
await app.close();
```

`compile()` перевіряє цикли, дублікати ID, відсутні залежності, scope leaks, колізії маршрутів, схеми й HTTP-коди. Для кожної операції будується план її транзитивних залежностей по рівнях. Незалежні request-ресурси відкриваються паралельно, спільна залежність обчислюється один раз на виклик. Application-ресурси відкриваються під час компіляції у порядку залежностей. Звільнення відбувається у зворотному порядку; executor чекає завершення всього паралельного рівня навіть при помилці.

`run` отримує тільки оголошені `needs`, `input` і `signal`. Request-ресурси додатково отримують стандартний `Request`. Це обмеження контексту та типізації, а не sandbox довільного JavaScript: глобальні змінні й прямі імпорти залишаються відповідальністю застосунку. Scope leaks перевіряються під час `compile()`.

Очікувані помилки повертаються через `error('CODE')` і оголошуються як `errors: { CODE: 404 }`. Неоголошені помилки та невалідний output є збоями сервера. `Fault` використовується адаптерами/capabilities, наприклад для 401. Некоректний input повертає 400.

## Stand

- Клікабельний граф зі справжнього Architecture IR, контракти та execution plans.
- Генерація валідного input і прикладу невалідного input; прямий та HTTP запуск операції.
- RPM, p50/p95, кількість помилок і spans відкриття request-ресурсів та операцій. Буфер обмежений 500 traces; RPM — виклики в останню хвилину в межах цього буфера.
- Збереження результату як тесту та повторний запуск тестів **у пам’яті поточного сеансу**. Для сценаріїв з авторизацією використовуйте кодові тести з підміною capabilities.
- Обмежений in-process load test із concurrency, RPS, p50/p95 і помилками. Цей тест ділить event loop із застосунком і не є зовнішнім production benchmark.
- Ін’єкція затримки/помилок в операції та відкриття request-ресурсів. Уже відкриті application-ресурси не переініціалізуються.

Метрики вимірюються наявним executor. Внутрішні запити до DB чи виклики методів repository автоматично не перехоплюються. `estimateMs` і `effects` є явними метаданими вузлів; без значення оцінка лишається `null`.

## Інші адаптери

`rpc(app, { 'users.get': getUser })` повертає Web handler JSON-RPC 2.0 з явним переліком доступних операцій. Його можна передати в `serve`. `queue(app, operation, { concurrency, capacity })` дає `enqueue`, `metrics`, `close`; це черга в пам’яті. `schedule(app, operation, { everyMs, input, onError })` запускає неперекривні interval-виклики. Черги й планувальники потрібно закривати перед `app.close()`.

`client(app, { getUser })` дає типізований локальний клієнт із виведенням input/output. `test(operation).provide(resource, fake).run(input)` запускає операцію без HTTP та не відкриває підмінений application-ресурс.

## Стан реалізації

Це робоча початкова реалізація архітектури з `doc.md`. Подальші частини концепції: durable queue/cron adapters, distributed deployment та bundling, OpenTelemetry export, DB instrumentation, persisted scenarios/record→test, повний property-based fuzzing, автоматичний пошук межі навантаження, what-if симуляції, architecture diff, генерація мережевого SDK і самокалібровані оцінки. Вони ще не реалізовані. Заяв про перевагу у швидкодії над Express чи Fastify без окремих benchmark немає.
