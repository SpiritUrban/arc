# 05. Тести, Stand і перевірка build

Architecture graph та runtime activity відповідають на різні запитання: що система може виконувати і що вона виконала в конкретному interaction.

## Перевірте graph без activation

```sh
npm run graph
npm run inspect -- orders.create
```

Graph/inspect не відкривають application resources. В IR v3 є browser/server/shared targets, declared dependencies і remote boundaries. Compiler повідомляє про runtime boundary violation, duplicate IDs та declared cycles.

## Виконайте interaction

```sh
npm run dev:workspace
```

У Workspace створіть замовлення. Відкрийте Stand :3100, виберіть вузол `orders.create.submit` і простежте стрілки. Для огляду скористайтеся кнопкою «Увесь граф», а щоб побачити лише віддалені виклики, виберіть Boundaries. Знайдіть виконання за trace ID. Browser action, remote call, server operation і binding updates можуть належати одному logical trace.

Remote duration включає transport/server overhead; це не точне окреме вимірювання network latency. Browser telemetry призначене для development debugging, не production distributed tracing.

## Запустіть перевірки

```sh
npm test
npm run typecheck
npm run typecheck:core
npm run build
npm run test:distribution
```

Root build компілює framework/server ESM і browser bundle Workspace. Для Tasks використовуйте npm run build:fullstack, для Counter — npm run build:web. Окремі команди збірки записують файли в `.arc/web`. Запущені CLI застосунки використовують власні тимчасові збірки.

## Прочитайте integration test

tests/workspace.test.ts виконує зібраний frontend через real HTTP та перевіряє create-user/order flow, duplicate email, escaping, identity isolation, trace continuity й disposal. DOM середовище Linkedom не замінює real-browser visual QA.

## Куди рухатися далі

Читайте про [форми та оновлення ресурсів](../../../docs/fullstack/remote-operations.md), [життєвий цикл](../../../docs/web/lifecycle.md) і [межі браузерної збірки](../../../docs/fullstack/runtime-boundaries.md).

Ви завершили introductory course. Спробуйте додати нову feature до Workspace: почніть із contract та operation, потім resource/action, bindings і integration test.
