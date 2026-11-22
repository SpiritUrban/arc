# ARC Web: початок роботи

ARC Web працює без ARC Server. Імпортуйте browser primitives з `@arc/framework/web`, нейтральну composition — з `@arc/framework/core`.

```ts
import { state, derive } from "@arc/framework/web";
const count = state({ id: "counter.value", initial: 0 });
const doubled = derive({
  id: "counter.doubled",
  from: count,
  compute: (n) => n * 2,
});
count.update((n) => n + 1);
```

Для прикладу ARC Workspace запускайте `npm run dev:workspace`: UI :3000, Stand :3100. [Як він влаштований](../workspace-app.md). Для pure-Web Counter запустіть `npm run dev:web-counter`. Канонічний приклад: [app.ts](../../examples/web-counter/app.ts), [page.tsx](../../examples/web-counter/page.tsx), [browser.ts](../../examples/web-counter/browser.ts). `npm run build:web` створює `.arc/web/app.js`, index.html, manifest.json та architecture.json.

`application({modules:[module({id,web:{nodes,entry}})]})` з core описує один logical graph. Node identity задається явно; шлях файлу не визначає runtime. Browser entry створює `webApplication({nodes})`, викликає start і mount, а на pagehide — dispose. Dev CLI обслуговує static assets і telemetry; цей допоміжний Node host не входить у browser graph.

Розмітку пишіть у `.tsx` через `view({ template })`. Для нового проєкту налаштуйте `jsxImportSource: "@arc/framework/web"` за [посібником TSX](views.md#налаштування-typescript).

[State/derive](state-and-derived.md) · [Actions/resources](actions-and-resources.md) · [Views](views.md). Звичайний external fetch без ARC backend показано у [прикладі](../examples/web-external.ts).

## Що запускати й збирати

| Проєкт                  | Dev                   | Browser build           |
| ----------------------- | --------------------- | ----------------------- |
| Workspace (`examples/workspace/`) | npm run dev:workspace           | npm run build:app       |
| Pure Web Counter        | npm run dev:web-counter       | npm run build:web       |
| Fullstack Tasks example | npm run dev:fullstack-tasks | npm run build:fullstack |

Окремі команди browser build записують файли в `.arc/web`. Кожен запущений CLI застосунок обслуговує власну тимчасову збірку. З різними `PORT` і `STAND_PORT` можна запускати кілька прикладів одночасно. `npm run build` також компілює ESM фреймворку та прикладів. Потрібні root development dependencies, зокрема esbuild; production server-only consumer цього tooling не потребує. HMR/watch немає: після source змін перезапустіть dev.

[Повний frontend index](README.md) · [Покрокове написання feature](writing-frontend.md) · [Input/forms](forms-and-events.md) · [Lifecycle](lifecycle.md) · [Тести](testing.md).
