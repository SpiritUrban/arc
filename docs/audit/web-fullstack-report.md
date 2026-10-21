# ARC 0.3: Server / Web / Fullstack MVP

Перевірено 2026-10-21, Node.js 24.19.0. [План перед реалізацією](web-fullstack-plan.md). Це snapshot перевіреного MVP, не заява про production readiness усіх frontend scenarios.

## Архітектурні рішення та packages

Один logical application graph компілюється у browser/server/shared partitions. Збережено server executor, dependency-ready scheduler, explicit needs/calls, typed errors, contracts, activation lifecycle та Stand. Виділено neutral graph/contracts/protocol/compiler, який typechecked без DOM/Node libraries. Node adapters не імпортуються browser entrypoints.

Поки один фізичний package @arc/framework 0.3.0 з ESM/declarations subpaths: core, server, web, fullstack, fullstack/server, fullstack/build, stand. Root API лишився server-compatible. Окремих опублікованих @arc/core чи @arc/web packages немає. esbuild — optional peer лише для browser tooling; tsx — development dependency.

Composition розширює існуючий module через web:{nodes,entry,serverModules?}, замість заміни server API універсальним nodes масивом. Нейтральна core application підтримує standalone Web metadata; server application додає execution server partition того самого IR. Directory naming не визначає runtime.

## IR v2 → v3 та invariants

[Повний canonical IR v3](fullstack-ir-v3.json), [міграція](../migration-0.3.md).

```text
tasks.new-title [state/browser]
  → tasks.title-input [binding/browser] → tasks.page [view/browser]
tasks.add [action/browser]
  DEPENDS_ON → tasks.create-boundary [remote-endpoint/browser]
    REMOTE_CALLS → tasks.create [operation/server]
      DEPENDS_ON → tasks.repository [resource/server]
  INVALIDATES → tasks.current [web-resource/browser]
    REMOTE_CALLS → tasks.list [operation/server]
      DEPENDS_ON → tasks.repository
  tasks.current.data DERIVES projection
    BINDS → tasks.list-text [binding/browser] → tasks.page
contracts [shared]
```

27 nodes, 3 declared remote boundary edges (resource та його endpoint описують той самий logical list call на різних рівнях). Shared input/output contract nodes додаються і для server-only operations. Нові kinds: state/derived/web-resource/action/view/binding/remote-endpoint/contract. Нові relations: DERIVES/BINDS/REMOTE_CALLS/INVALIDATES; старі relations збережені.

Compiler перевіряє IDs, declared cycles, dependencies, runtime boundaries, exposure та contract compatibility з graph path. Browser не може прямо залежати від server resource; remote edge допускається лише до exposed operation. Compile не відкриває application resources. Server request resources залишаються shared у nested ctx.call execution context; cleanup deterministic. Browser generation guards блокують stale resource results, unmount прибирає bindings/listeners, dispose abort pending resources.

Scheduled reactive propagation обчислює dependencies перед bindings; synchronous writes batched, view setup один раз на mount, VDOM відсутній. Eager derive.get між writes може спричиняти додаткові recomputations; async action не тримає глобальний batch через await.

## API та канонічні приклади

[Pure Web counter](../../examples/web-counter/app.ts), [його view](../../examples/web-counter/page.ts): `npm run dev:web`. Server operations відсутні в graph. [External fetch](../../examples/web-external/example.ts) працює без ARC backend.

[Fullstack Tasks](../../examples/fullstack-tasks/app.ts), [contracts](../../examples/fullstack-tasks/contracts.ts), [server](../../examples/fullstack-tasks/server.ts), [browser page](../../examples/fullstack-tasks/page.ts): `npm run dev:fullstack`.

```ts
const title = state({ id: "tasks.new-title", initial: "" });
const tasks = remote(ListTasks, { id: "tasks.current" });
const create = remoteClient(CreateTask, { id: "tasks.create-boundary" });
const add = action({
  id: "tasks.add",
  needs: { create },
  invalidates: [tasks],
  async run(_, ctx) {
    const result = await create.call({ title: title.get() }, ctx);
    if (result.ok) ctx.set(title, "");
    return result;
  },
});
```

ListTasks/CreateTask — shared operationContract, server operation додає needs/run. `expose.web` явно дозволяє internal call на server. RemoteResult зберігає business error union/details, окремі fault/cancelled; faults не видають internal text/stack. Public REST routes не потрібні для internal transport.

## Stand та trace

Текстовий опис перевіреного graph: All показує browser state/action/resource/binding/view разом із server operation/repository та shared contracts; Frontend/Backend фільтрують targets, Boundaries — runtime crossings. Browser activity й server spans надходять через SSE; архітектура береться з IR, не з traces. Interaction panel групує їх за trace ID, metrics показують browser calls/outcomes/durations і binding update counts.

[Збережений фактичний integration trace](fullstack-interaction.json) використовує test nodes browser.add/create/list, не canonical Tasks IDs:

```text
один traceId
browser.add action
  browser.create remote
    server create operation
  browser.list resource reload
    browser.list.remote
      server list operation
  browser.count binding update
```

Окремий тест виконує зібраний canonical Tasks browser bundle в isolated VM з Linkedom та справжнім HTTP server: вводить title, натискає Add, перевіряє DOM і спільні trace IDs. Це не Chromium visual/screenshot QA. Remote duration включає network + server; ізольований network overhead і clock synchronization не вимірюються. Browser telemetry — untrusted best-effort debugging, не production distributed tracing.

## Bundle composition

[Fullstack manifest](fullstack-browser-manifest.json). Browser Inputs: Web reactive/view/async/runtime, neutral contracts/schema/protocol, fullstack client і shared Tasks contracts/page/browser. Немає core server executor, repository implementation, node:http/fs чи AsyncLocalStorage. Browser build приблизно 35.5 KB unminified; pure counter — 20.1 KB. Це artifact sizes цього прогону, не performance comparison.

Server використовує compiled TypeScript ESM: operations/resources/transport/shared contracts. Server entrypoint bundle test підтверджує відсутність Web DOM runtime. Direct remote(serverOperation) test перевіряє explicit serverModules transform і відсутність secret sentinel; canonical приклад використовує простіший shared descriptor. Довільний JS secret analysis не реалізований.

## Перевірки та вимірювання

- `npm test`: **51/51**, existing backend та нові graph/Web/DOM/resource/fullstack/build tests.
- Окремо lifecycle/concurrency: **12/12**, documentation examples: **2/2**.
- `npm run typecheck`, `typecheck:core`, `build`: пройдено.
- `build:web`, `build:fullstack`: пройдено.
- `test:distribution`: offline install tarball у clean consumer, plain ESM execution/CLI без tsx, core/web/fullstack compiled subpath imports, strict TypeScript consumer — пройдено.
- Real HTTP canonical interaction, exposure/input/output/error sanitization, trace continuity, stale request races, view-owned abort, subscription/listener cleanup та browser/server bundle boundaries — пройдено.
- Dev CLI smoke на :4321 (web+transport) / :4322 (Stand): index, app.js, graph і tasks.list повернули 200. Default :3000 зайнятий іншим процесом; його не змінювали.
- [Reactive benchmark JSON](web-reactivity-benchmark.json), команда `npm run benchmark:web`: 1000 реальних Linkedom DOM bindings, 100 writes в одному batch, **3 affected / 3 updates**, 3 derived nodes — **3 recomputations** після initialization. Приблизно **0.526 ms** цього synthetic Node/Linkedom прогону; не browser/deployment performance і не порівняння з React/Vue.

Попередній server scheduler before/after benchmark збережений в [аудиті 0.2](README.md); server scheduler не замінювався цією зміною.

## Відомі обмеження та roadmap

НЕ реалізовано: SSR, SSG, router, forms framework, advanced/durable cache, optimistic mutations, production distributed tracing, custom HMR. Dev робить basic build на старті, без watch/rebuild. Немає JSX/tagged templates, keyed list renderer, hydration, CSS system чи framework compatibility layers.

Application-owned browser nodes є спільними instances, не автоматично клонованими component state. Для незалежних view-owned instances використовуйте factory. Disposal перевірений через cleanup/subscriptions/abort, а не довготривалий heap profiler. Action snapshot відображає останній execution; concurrency control лишається application policy. Browser time/server time мають різні clocks. Stand browser telemetry endpoint придатний для development; authentication/authorization та production ingestion слід додати відповідно до deployment.

Подальші кроки: посилення production transport/security adapter, scope factories і browser heap/real-browser testing, interaction timing alignment, target-specific compiler optimization; потім за окремим дизайном SPA router, SSR/SSG та forms поверх тих самих contracts і View Graph.
