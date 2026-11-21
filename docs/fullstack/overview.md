# ARC Fullstack

Один feature module містить server operations/resources та `web:{nodes,entry}`. Це вибрано замість нового універсального nodes API, щоб зберегти server compatibility. Нейтральний compiler будує один IR v3 з browser/server/shared partitions та boundary manifest.

[Tasks application](../../examples/fullstack-tasks/app.ts) об’єднує [server](../../examples/fullstack-tasks/server.ts), [contracts](../../examples/fullstack-tasks/contracts.ts) та [page](../../examples/fullstack-tasks/page.tsx). Запуск: `npm run dev:fullstack-tasks`, web/server :3000, Stand :3100. `npm run build:fullstack` збирає browser assets; `npm run build` компілює framework/server ESM і збирає frontend Workspace; для Tasks assets використовуйте саме build:fullstack.

Shared `operationContract` містить id/input/output/errors/expose; сервер додає реалізацію через `operation(contract, implementation)`, а браузер використовує той самий контракт у `remote` або `remoteForm`. DTO source не дублюється. Browser bundle не імпортує repository.

[Remote](remote-operations.md) · [Boundaries/build](runtime-boundaries.md) · [Tracing](tracing.md). Майбутні SPA/SSR/SSG targets можуть використовувати той самий View Graph; SSR transport зможе замінити network на direct execution. Зараз реалізовано лише browser SPA execution. `remoteForm` підключає HTML-форму до контракту та керує станом надсилання.

## Fullstack-приклад Workspace

[ARC Workspace](../workspace-app.md) у `examples/workspace/` використовує users/orders server features і browser panels в одному IR. Його звичайний запуск — npm run dev:workspace. [Frontend guide](../web/writing-frontend.md) показує shared descriptors → resource/action → binding/view → root composition; [browser tests](../web/testing.md) перевіряють повний user flow.
