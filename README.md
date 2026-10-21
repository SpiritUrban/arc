# ARC — Application Runtime Graph Compiler

ARC is an application graph framework/compiler for server, browser and fullstack applications. Архітектура — executable application graph; compiler визначає runtime targets, contracts і явні boundaries.

| Режим         | API                                                       | Приклад                  |
| ------------- | --------------------------------------------------------- | ------------------------ |
| ARC Server    | operations, resources, HTTP/RPC/queue/schedule            | `docs/examples/tasks.ts` |
| ARC Web       | state, derive, action, webResource, fine-grained bindings | `examples/web-counter/`  |
| ARC Fullstack | один IR v3, remote boundaries, спільні contracts, traces  | `src/` (ARC Workspace)   |

```sh
npm install
npm run build
npm run dev # ARC Workspace: http://localhost:3000; Stand :3100
# або npm run dev:web / npm run dev:fullstack для малих прикладів
```

Node.js 22.18+. Фреймворк лежить окремо у `framework/`; feature-first application не залежить від обов’язкових client/server директорій.

[Документація](docs/README.md) · [Початок роботи](docs/getting-started.md) · [Архітектура](docs/architecture.md) · [Звіт реалізації 0.3](docs/audit/web-fullstack-report.md)

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

Server lifecycle: `compile → start → execute → close`. `graph`/`inspect` не відкривають ресурси. Browser lifecycle: `compile → start → mount → unmount → dispose`. View setup виконується один раз на mount; зміни оновлюють залежні DOM bindings без VDOM.

Compiled ESM і declarations доступні через `@arc/framework/{core,server,web,fullstack,stand}`; кореневий import зберігає server API. Production JS не потребує tsx. Browser build tooling використовує optional peer esbuild. SSR, SSG, router, forms, advanced cache й optimistic mutations ще не реалізовані.

## Кореневий застосунок: ARC Workspace

`src/` тепер містить frontend і backend одного проєкту: користувачі, вибір активного користувача, створення та історія замовлень. Запуск — `npm run dev`, сторінка http://localhost:3000, Stand http://localhost:3100. `npm run build` компілює ESM та browser assets; `npm run build:app` збирає тільки frontend.

[Посібник проєкту](docs/workspace-app.md). `examples/` залишаються малими навчальними прикладами.
