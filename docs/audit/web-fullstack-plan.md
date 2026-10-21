# ARC Server / Web / Fullstack: план перед реалізацією

## Аудит поточного фундаменту

Повторно використовуємо schema validation, typed Result/error contracts, server graph traversal, plans, start/close, metrics, nested calls, Node HTTP/RPC/queue/schedule, Stand і distribution tests. Поточний `core.ts` фактично є server runtime: він імпортує Node crypto/AsyncLocalStorage/timers та запускає workers. Його не можна експортувати з browser-neutral entrypoint.

## Рішення щодо пакетів

Перший етап — subpath exports одного npm package: `@arc/framework/core`, `/server`, `/web`, `/fullstack`, `/stand`. Це підготовка до @arc/core/server/web/fullstack/stand без передчасного фізичного дроблення. Root export зберігає server API. Runtime-neutral graph/IR/contracts/results/protocol живуть у neutral layer; DOM implementation тільки у web; Node lifecycle/adapters тільки у server. Browser/fullstack client entries не імпортують server implementation.

## Feature composition: порівняння

`module({nodes:[...]})` дає єдиний список, але operation/resource уже мають перевірені typed collections, а contract не є executable node. Обираємо сумісне розширення `module({operations,resources,routes,web:{nodes,entry?}})` та `application({modules,web?})`. `web.nodes` — roots explicit graph, transitive reactive nodes збираються compiler-ом. Один logical Application генерує один IR v3 з partitions/manifests. Web-only application compiler використовує те саме neutral graph infrastructure без server runtime.

## IR v3 / targets / diagnostics

Кожен node має runtime browser/server/shared, типовий із kind. Зберігаються всі IR v2 nodes/edges, додаються state/derived/web-resource/action/view/binding/remote-endpoint та DERIVES/BINDS/REMOTE_CALLS/INVALIDATES. Contracts описуються shared metadata, не примусово executable nodes. Neutral compiler перевіряє duplicate IDs, cycles, explicit dependencies, runtime boundaries, exposure та contract signatures із graph paths (ARC201/WEB diagnostics). Remote edge є єдиним дозволеним browser→server executable transition.

## API MVP

- `state({id,initial})`: get/set/update, application або instance ownership.
- `derive({id,from,compute})`: explicit inputs, cached output.
- `view({id,needs,bindings,setup})`: setup один раз; imperative DOM builder/bindings, без VDOM/JSX compiler.
- `action({id,input?,needs?,invalidates?,run})`: execution status/result/error/running як observable projections.
- `webResource({id,from,input,load})`: data/loading/error/stale, refresh/invalidate, AbortSignal та generation guard.
- `remote(operationContractOrOperation,{id,from,input})` для data, `remoteCall` для mutation; explicit exposed server operation (`expose:{web:true}`), однакові schemas/errors.

Remote client приймає structural operation contract без імпорту Node runtime. Canonical example ділить direct shared contract object між server operation та browser descriptor; compiler/build перевіряє signature. Для прямого remote(serverOperation) bundler має замінювати явно оголошені server modules contract-only exports, а не сподіватися на tree shaking secrets.

## Reactive scheduler та lifecycle

Writes накопичуються microtask batch; affected derived nodes обчислюються топологічно ≤1 раз, bindings після stabilized values ≤1 раз. Synchronous action prefix batching не тримає глобальну transaction відкритою через await. Inputs/resource invalidation також batch. Mount створює instance scope; unmount/dispose прибирає listeners/subscriptions, зупиняє owned resource loads і звільняє DOM references. Application-owned shared nodes живуть до dispose web application. Async generation guards блокують stale completion навіть без підтримки underlying abort.

## Security / trace / builds

Internal `/_arc/call/:id` — окремий transport, explicit exposure перевіряється server-side; schemas та typed Result зберігаються, raw exception не виходить. Trace ID та parent span передаються headers; browser telemetry має окремий validated ingest endpoint, untrusted client source позначений явно. Shared contracts не означають shared resource state/secrets.

Esbuild як implementation tool: neutral compiler формує partitions і boundary manifest, browser entry roots та server-module exclusions. Browser bundle перевіряється проти Node modules/server implementation. Один app origin віддає web/assets/internal transport, Stand — окремий порт. HMR не пріоритет; explicit rebuild/restart достатньо.

## Міграція й перевірки фаз

IR v2→v3 — явний version bump; server API/lifecycle лишаються. A: neutral graph/targets/composition + backend suite. B: reactive core + tests. C: DOM bindings/lifecycle + tests. D: action/resource/races + tests. E: exposure/remote/trace/build separation + tests. F: unified Stand/telemetry/filters. G: canonical examples, docs, clean browser/server package consumers, benchmarks.

Не реалізуємо SSR/SSG/router/forms/advanced cache/optimistic/offline/production distributed tracing. Future SPA/SSR/SSG targets використовуватимуть View Graph; same-runtime remote boundary може отримати direct executor у майбутньому. Жодних claims про швидкість React/Vue.
