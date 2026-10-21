# ARC Fullstack

Один feature module містить server operations/resources та `web:{nodes,entry}`. Це вибрано замість нового універсального nodes API, щоб зберегти server compatibility. Нейтральний compiler будує один IR v3 з browser/server/shared partitions та boundary manifest.

[Tasks application](../../examples/fullstack-tasks/app.ts) об’єднує [server](../../examples/fullstack-tasks/server.ts), [contracts](../../examples/fullstack-tasks/contracts.ts) та [page](../../examples/fullstack-tasks/page.ts). Запуск: `npm run dev:fullstack`, web/server :3000, Stand :3100. `npm run build:fullstack` збирає browser assets; `npm run build` — compiled server ESM.

Shared `operationContract` містить id/input/output/errors/expose; server operation розширює його needs/run, browser remote використовує той самий contract. DTO source не дублюється. Browser bundle не імпортує repository.

[Remote](remote-operations.md) · [Boundaries/build](runtime-boundaries.md) · [Tracing](tracing.md). Майбутні SPA/SSR/SSG targets можуть використовувати той самий View Graph; SSR transport зможе замінити network на direct execution. Зараз реалізовано лише browser SPA execution. Forms зможуть читати schemas, але forms API поки немає.
