# @arc/framework

ARC — full-stack фреймворк, у якому застосунок будують навколо доменних операцій. Спільний контракт описує вхід, результат і бізнес-помилки. Сервер реалізує операцію та оголошує її залежності. ARC пов’язує їх із транспортом та інтерфейсом у виконуваному графі, який можна переглянути в Stand.

Потрібен Node.js 22.18+. Пакет використовує ESM.

## Public package

`import { application, operation, s, ok } from '@arc/framework'` використовує compiled `dist/index.js`; TypeScript отримує `dist/index.d.ts`. CLI bin `arc.mjs` завантажує compiled CLI. Runtime dependencies на tsx немає. Opt-in condition `arc-source` адресує source тільки для development.

```js
import { application, operation, s, ok } from "@arc/framework";

const health = operation({
  id: "system.health",
  input: s.object({}),
  output: s.string(),
  run: () => ok("ok"),
});

const app = application({ operations: [health] });
await app.compile();
try {
  await app.start();
  console.log(await app.execute("system.health", {}));
} finally {
  await app.close();
}
```

Compile не викликає resource.open. Activate є alias start; graph/inspect не активують ресурси. Entry module не повинен сам відкривати зовнішні системи під час імпорту.

## CLI та build

З кореня монорепозиторію:

```sh
npm install
npm run build
npm run dev
npm test
npm run test:distribution
```

Production CLI: `ARC_APP=dist/examples/workspace/app.js node framework/arc.mjs start`. Після встановлення зібраного пакета в інший ESM-проєкт: `ARC_APP=src/app.js npx arc start`, де app.js default-export містить результат application(...).

## TSX-шаблони

Задайте `"jsx": "react-jsx"` і `"jsxImportSource": "@arc/framework/web"` у параметрах TypeScript. Сторінка читає дані з `query(contract)`, а форма передає `mutation(contract)` в `onSubmit`. ARC оновлює залежні ділянки DOM. Файлові сторінки автоматично вмикають реактивний JSX у своїх TSX-модулях; для окремих TSX-файлів лишається директива `// @arc reactive-jsx`.

## Документація репозиторію

[Журнал змін](../CHANGELOG.md), [посібник](../docs/README.md), [архітектура](../docs/architecture.md), [написання коду](../docs/writing-code.md), [API](../docs/api.md), [тести та Stand](../docs/testing-and-stand.md), [міграція 0.1 → 0.2](../docs/migration-0.2.md), [аудит і roadmap](../docs/audit/README.md).

Ці відносні посилання працюють у монорепозиторії. Каталог docs не входить у npm tarball; цей README містить standalone bootstrap, повний посібник зберігається в репозиторії ARC.

## Runtime-specific entrypoints

`@arc/framework/core` — neutral graph/contracts; `/server` — server; `/web` — fine-grained browser runtime; `/fullstack` — browser remote bridge; `/fullstack/server` і `/fullstack/build` — Node integration; `/stand` — tooling. Один physical package, підготовлений до майбутнього розділення. Browser build/dev потребує optional peer esbuild; server-only JS — ні.

[Web](../docs/web/getting-started.md), [Fullstack](../docs/fullstack/overview.md), [IR v3 migration](../docs/migration-0.3.md).

Frontend посібники: [зміст ARC Web](../docs/web/README.md), [як писати feature](../docs/web/writing-frontend.md), [forms/events](../docs/web/forms-and-events.md), [lifecycle](../docs/web/lifecycle.md), [тести](../docs/web/testing.md). Fullstack-приклад: [ARC Workspace](../docs/workspace-app.md).
