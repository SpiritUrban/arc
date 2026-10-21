# Початок роботи з ARC 0.2

[← Зміст](README.md)

Потрібен Node.js 22.18+. З кореня репозиторію:

```sh
npm install
npm run build
npm run dev
```

Application: http://localhost:3000; Stand: http://localhost:3100; OpenAPI: http://localhost:3000/openapi.json.

`framework/` — окремий workspace @arc/framework; `src/` — кореневий application із users/orders. Код фреймворку не імпортує application. Навчальний feature приклад: `docs/examples/tasks.ts`.

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
| `npm run dev`                      | Source development CLI із tsx; без watch/reload |
| `npm start`                        | Development HTTP без Stand                      |
| `npm run graph`                    | Pure graph, без activation                      |
| `npm run inspect -- orders.create` | Контракт/plan вузла                             |
| `npx arc run system.health '{}'`   | Compiled CLI, direct execution                  |
| `npm test`                         | Unit/integration                                |
| `npm run test:lifecycle`           | Lifecycle/concurrency окремо                    |
| `npm run typecheck`                | TypeScript і negative type tests                |
| `npm run build`                    | framework/dist JS/.d.ts + root dist             |
| `npm run test:distribution`        | Packed package smoke test без tsx               |
| `npm run benchmark:scheduler`      | Штучний DAG benchmark                           |

Native JS production entrypoint:

```sh
ARC_APP=dist/src/app.js node framework/arc.mjs start
```

Ця команда використовує compiled ESM без tsx. Development скрипти використовують condition `arc-source`, щоб приклад і тести імпортували саме source workspace. За замовчуванням package import веде на `framework/dist/index.js`, types — на `.d.ts`. Після зміни коду перед перевіркою compiled CLI повторіть build.

`ARC_APP` типовий src/app.ts (від cwd), PORT — 3000, STAND_PORT — 3100. Для TypeScript entrypoint Node 22.18+ підтримує erasable syntax; для іншого TS-синтаксису застосунку використовуйте dev script або compiled JS. CLI пакета не залежить від tsx.

```sh
PORT=4000 STAND_PORT=4100 npm run dev
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
