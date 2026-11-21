# Початок роботи з ARC

[← Зміст](README.md) · [Міграція 0.1 → 0.2](migration-0.2.md)

Потрібен Node.js 22.18+. З кореня репозиторію:

```sh
npm install
npm run build
npm run dev:workspace
```

Application: http://localhost:3000; Stand: http://localhost:3100; OpenAPI: http://localhost:3000/openapi.json.

`framework/` — окремий workspace @arc/framework; `examples/workspace/` — fullstack-приклад із користувачами та замовленнями. Код фреймворку не імпортує application. Навчальний feature приклад: `docs/examples/tasks.ts`.

## Lifecycle та зміна з 0.1

```ts
await app.compile(); // pure, без DB/Redis/SMTP
await app.start(); // або activate()
try {
  await app.execute("system.health", {});
} finally {
  await app.close();
}
```

CLI сам викликає compile і start для start/stand/run; graph/inspect виконують тільки compile. Default-export entrypoint має лише створити application, без top-level підключень до зовнішніх систем. Старе compile → execute потрібно мігрувати на compile → start → execute.

## Команди

| Команда                            | Призначення                                     |
| ---------------------------------- | ----------------------------------------------- |
| `npm run dev:workspace`                      | Source development CLI із tsx; без watch/reload |
| `npm start`                        | Development HTTP без Stand                      |
| `npm run graph`                    | Pure graph, без activation                      |
| `npm run inspect -- orders.create` | Контракт/plan вузла                             |
| `npx arc run system.health '{}'`   | Compiled CLI, direct execution                  |
| `npm test`                         | Unit/integration                                |
| `npm run test:lifecycle`           | Lifecycle/concurrency окремо                    |
| `npm run typecheck`                | TypeScript і negative type tests                |
| `npm run build`                    | framework/dist + root dist + browser .arc/web   |
| `npm run test:distribution`        | Packed package smoke test без tsx               |
| `npm run benchmark:scheduler`      | Штучний DAG benchmark                           |

Native JS production entrypoint:

```sh
ARC_APP=dist/examples/workspace/app.js node framework/arc.mjs start
```

Ця команда використовує compiled server ESM без tsx. Для Workspace CLI також збирає browser assets з налаштованого web.entry: потрібні esbuild та доступний examples/workspace/browser.ts із його imports. Це поточний CLI flow, а не standalone deployment готових static assets без source. Development скрипти використовують condition `arc-source`, щоб приклад і тести імпортували саме source workspace. За замовчуванням package import веде на `framework/dist/index.js`, types — на `.d.ts`. Після зміни коду перед перевіркою compiled CLI повторіть build.

Скрипти репозиторію за замовчуванням використовують `examples/workspace/app.ts`. Для прямого запуску CLI `ARC_APP` за замовчуванням вказує на `src/app.ts` від поточної теки. Типові порти — 3000 для застосунку і 3100 для Stand. Для TypeScript entrypoint Node 22.18+ підтримує erasable syntax; для іншого TS-синтаксису застосунку використовуйте dev script або compiled JS. CLI пакета не залежить від tsx.

```sh
PORT=4000 STAND_PORT=4100 npm run dev:workspace
ARC_APP=docs/examples/tasks.ts npx arc stand
```

CLI слухає loopback. Node bridge має Host allowlist localhost/127.0.0.1/[::1]. Public ingress/proxy needs окремої адаптації, а не лише host 0.0.0.0. Ctrl+C/SIGTERM закриває SSE streams, HTTP servers та application lifecycle.

## Приклад HTTP

```sh
curl http://localhost:3000/health
curl http://localhost:3000/users
curl -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer 00000000-0000-4000-8000-000000000001' \
  -d '{"product":"ARC Book","quantity":2}'
```

Demo auth перевіряє наявного користувача за UUID, не JWT. Repositories — у пам’яті. Вони мають явні async instrumented methods для traces/failure injection, але не є DB adapter.

## Package distribution

```sh
npm pack --workspace @arc/framework
```

Пакет містить compiled ESM, declarations, CLI bin і source для opt-in development condition. Production consumers імпортують JS без TypeScript loader:

```js
import { application, operation, s, ok } from "@arc/framework";
```

При локальній file-залежності спочатку зберіть framework: `npm run build --workspace @arc/framework`; після встановлення в іншому ESM-проєкті експортуйте application із вашого JS entrypoint і задайте ARC_APP. Чистий tarball install/import/CLI перевіряє `npm run test:distribution`.

Якщо порти зайняті іншим прикладом, спочатку зупиніть попередній процес або задайте інші PORT/STAND_PORT. Після редагування source compiled package та CLI оновлюються лише через build; development scripts читають source напряму, але не перезапускають сервер автоматично.

## Три runtime режими

`npm run dev:workspace` запускає fullstack-приклад ARC Workspace, `npm run dev:web-counter` — pure Web counter, `npm run dev:fullstack-tasks` — Tasks. Для одночасного запуску задайте різні `PORT` і `STAND_PORT` для кожного застосунку. Web та internal transport мають один origin.

`npm run build:app` збирає frontend Workspace; `npm run build:web` / `npm run build:fullstack` створюють browser assets навчальних прикладів у .arc/web. CLI `arc dev` compile/build/start/serve і відкриває Stand; це basic build на старті, без watch/HMR. [Web guide](web/getting-started.md), [Fullstack guide](fullstack/overview.md).

Деталі UI Workspace та його graph: [ARC Workspace](workspace-app.md). Root `npm run build` включає browser build.

Frontend розробка: [зміст](web/README.md), [feature guide](web/writing-frontend.md), [forms](web/forms-and-events.md), [lifecycle](web/lifecycle.md), [тести](web/testing.md).
