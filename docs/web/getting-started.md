# ARC Web: початок роботи

ARC Web працює без ARC Server. Імпортуйте browser primitives з `@arc/framework/web`, нейтральну composition — з `@arc/framework/core`.

```ts
import { state, derive } from "@arc/framework/web";
const count = state({ id: "counter.value", initial: 0 });
const doubled = derive({
  id: "counter.doubled",
  from: [count],
  compute: (n) => n * 2,
});
count.update((n) => n + 1);
```

Для кореневого ARC Workspace запускайте `npm run dev`: UI :3000, Stand :3100. [Як він влаштований](../workspace-app.md). Для pure-Web Counter запустіть `npm run dev:web`. Канонічний приклад: [app.ts](../../examples/web-counter/app.ts), [page.ts](../../examples/web-counter/page.ts), [browser.ts](../../examples/web-counter/browser.ts). `npm run build:web` створює `.arc/web/app.js`, index.html, manifest.json та architecture.json.

`application({modules:[module({id,web:{nodes,entry}})]})` з core описує один logical graph. Node identity задається явно; шлях файлу не визначає runtime. Browser entry створює `webApplication({nodes})`, викликає start і mount, а на pagehide — dispose. Dev CLI обслуговує static assets і telemetry; цей допоміжний Node host не входить у browser graph.

[State/derive](state-and-derived.md) · [Actions/resources](actions-and-resources.md) · [Views](views.md). Звичайний external fetch показано у [прикладі](../../examples/web-external/example.ts); ARC backend не потрібен.

## Що запускати й збирати

| Проєкт                  | Dev                   | Browser build           |
| ----------------------- | --------------------- | ----------------------- |
| Root Workspace (`src/`) | npm run dev           | npm run build:app       |
| Pure Web Counter        | npm run dev:web       | npm run build:web       |
| Fullstack Tasks example | npm run dev:fullstack | npm run build:fullstack |

Кожна browser build команда записує .arc/web; наступний build замінює попередні assets. Root npm run build також компілює framework/application ESM і збирає root frontend. Потрібні root development dependencies, зокрема esbuild; production server-only consumer цього tooling не потребує. HMR/watch немає: після source змін перезапустіть dev.

[Повний frontend index](README.md) · [Покрокове написання feature](writing-frontend.md) · [Input/forms](forms-and-events.md) · [Lifecycle](lifecycle.md) · [Тести](testing.md).
