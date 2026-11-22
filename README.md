# ARC — Application Runtime Graph Compiler

**ARC — full-stack фреймворк для застосунків, побудованих навколо доменних операцій.** Операція на кшталт «створити замовлення» має контракт, бізнес-логіку й явні залежності. ARC збирає операції, ресурси, транспорт та інтерфейс у виконуваний граф.

Браузер читає дані через `query` і надсилає зміни через `mutation` за спільними із сервером контрактами. Mutation може перечитати query через `refresh` або відразу застосувати повну відповідь через `update`. У Stand видно шлях від дії в інтерфейсі до серверної операції й оновлення даних.

| Режим         | API                                                       | Приклад                  |
| ------------- | --------------------------------------------------------- | ------------------------ |
| ARC Server    | operations, resources, HTTP/RPC/queue/schedule            | `docs/examples/tasks.ts` |
| ARC Web       | TSX-шаблони, state, derive, action, DOM bindings           | `examples/web-counter/`  |
| ARC Fullstack | один IR v3, remote boundaries, спільні contracts, traces  | `examples/workspace/` (ARC Workspace)   |

[Офіційний сайт ARC](https://spiriturban.github.io/arc/) · [Публікації GitHub Actions](https://github.com/SpiritUrban/arc/actions/workflows/docs-pages.yml)

## Локальний запуск

Потрібен Node.js 22.18+. З кореня репозиторію виконайте `npm install`, потім оберіть один із сайтів.

| Що запустити | Каталог | Команда | Адреса |
| --- | --- | --- | --- |
| Офіційний сайт ARC з документацією та уроками | `website/` | `npm run dev:docs-site` | [localhost:4400](http://localhost:4400) |
| ARC Workspace, демозастосунок із користувачами та замовленнями | `examples/workspace/` | `npm run dev:workspace` | [localhost:3000](http://localhost:3000) |
| Web Counter, браузерний приклад | `examples/web-counter/` | `npm run dev:web-counter` | [localhost:3000](http://localhost:3000) |
| Fullstack Tasks, приклад зі списком задач | `examples/fullstack-tasks/` | `npm run dev:fullstack-tasks` | [localhost:3000](http://localhost:3000) |

Workspace, Counter і Tasks також відкривають [ARC Stand](http://localhost:3100) для перегляду графа застосунку. Для одночасного запуску задайте різні `PORT` і `STAND_PORT` для кожного застосунку. Офіційний сайт можна запустити паралельно з будь-яким із них. Команди самі готують потрібні файли, тому попередня збірка не потрібна. Після змін у коді перезапустіть відповідну команду.

`framework/` містить бібліотеку, компілятор і CLI, якими користуються застосунки. Збірка пакета запускається командою `npm run build --workspace @arc/framework`.

[Документація](docs/README.md) · [Початок роботи](docs/getting-started.md) · [Архітектура](docs/architecture.md) · [Журнал змін](CHANGELOG.md)

```sh
npm test
npm run test:lifecycle
npm run typecheck
npm run typecheck:core
npm run build
npm run test:distribution
npm run build:web
npm run build:fullstack
npm run benchmark:web
```

Server lifecycle: `compile → start → execute → close`. `graph`/`inspect` не відкривають ресурси. Browser lifecycle: `compile → start → mount → unmount → dispose`. [TSX-шаблон](docs/web/views.md) описує DOM і прив’язки. ARC додає їх до графа до mount, а після mount оновлює залежні ділянки DOM.

Зібрані ESM-модулі й типи доступні через `@arc/framework/{core,server,web,fullstack,stand}`. Кореневий імпорт надає серверний API. Зібраний серверний JS працює без `tsx`. Для браузерної збірки використовується `esbuild`. [Запити й форми](docs/fullstack/remote-operations.md) · [Реактивний JSX](docs/web/views.md)

## Збірка застосунку та сайту

`npm run build` компілює фреймворк і серверний код та збирає frontend Workspace. `npm run build:app` збирає лише frontend Workspace.

`npm run build:site` генерує статичний сайт у `website/dist/`. `npm run test:site` перевіряє його сторінки, посилання та взаємодії.

[Посібник ARC Workspace](docs/workspace-app.md) · [Як редагувати й опублікувати сайт](docs/website.md)
