# Архітектура ARC 0.3

[← Зміст](README.md) · [Аудит і міграція](audit/README.md)

ARC зберігає модель executable architecture graph: контракти описують дані, операції — сценарії, ресурси/capabilities — явні залежності. Компілятор, runtime і Stand працюють із цією самою архітектурою.

## Lifecycle: compile → start → execute → close

```ts
await app.compile(); // метадані, invariants, плани; без open()
await app.start(); // або activate(): відкриття application-ресурсів
try {
  await app.execute("orders.create", input);
} finally {
  await app.close();
}
```

`compile()` збирає транзитивні `needs` та `calls`, перевіряє унікальність ID, цикли, scopes, підтриману структуру схем, error mappings і маршрути. Будує dependency-ready execution plans та Architecture IR v3. Не викликає `open`, `run`, `sample`, schedule input або validation callbacks. `graph()` та `inspect` читають тільки метадані. Сам імпорт користувацького entrypoint все ще виконує його top-level JavaScript: не відкривайте DB на рівні модуля.

`start()` послідовно відкриває application-ресурси у топологічному порядку, потім створює queue workers і запускає schedules. Одночасні start-виклики отримують один Promise; повторний start активного application не створює ресурси повторно. При partial failure відкриті ресурси закриваються; можна повторити start. Помилки activation і rollback зберігаються в AggregateError.

`execute()` до start відхиляється. Прихованого auto-start немає. `close()` є idempotent, чекає start, якщо він триває, припиняє schedules і нові зовнішні виклики, дренує прийняті queue jobs та активні execution contexts, потім закриває application-ресурси. Зовнішні HTTP-сервери закриває їхній власник; CLI робить це сам. Після close application не перезапускається.

## Architecture IR v3

| Node kind    | Значення                                                |
| ------------ | ------------------------------------------------------- |
| `operation`  | Контракт, errors, calls, plan, declared estimate/budget |
| `resource`   | Application/request capability                          |
| `http-route` | HTTP ingress із методом та шляхом                       |
| `queue`      | Черга із capacity                                       |
| `worker`     | Споживач черги із concurrency                           |
| `schedule`   | Інтервальне джерело запуску                             |
| `effect`     | Явно instrumented async-method ресурсу                  |

| Edge kind    | Напрям                                                                      |
| ------------ | --------------------------------------------------------------------------- |
| `DEPENDS_ON` | operation/resource → потрібний resource                                     |
| `ROUTES_TO`  | http-route → operation                                                      |
| `CALLS`      | operation → declared child operation; worker → operation; resource → effect |
| `CONSUMES`   | worker → queue                                                              |
| `TRIGGERS`   | schedule → operation                                                        |

`EMITS` зарезервовано в типі edge kinds; автоматичне виявлення producer-викликів enqueue не реалізовано. Черги та schedules оголошуються у application/module до compile, тому доступні у graph без start. Legacy runtime helpers можуть приєднати транспорт до вже активного application: це явно додає вузли/ребра та публікує `graph.updated`, але не компілює нові операції.

Готовий приклад IR: [architecture-ir.json](audit/architecture-ir.json).

## Explicit needs та operation calls

`needs` містить тільки resource-визначення. Контекст отримує саме значення цих ресурсів, а не весь registry.

```ts
const parent = operation({
  id: "parent",
  input: s.object({}),
  output: s.int(),
  calls: { child },
  async run({ call }) {
    return call("child", {});
  },
});
```

`calls` є явним allowlist. Компілятор знаходить child транзитивно та додає CALLS relation. `ctx.call` типізує ім’я та input/output child. Неоголошене ім’я відхиляється і runtime-перевіркою. Цикли operation calls заборонені під час compile; runtime додатково захищається від рекурсії.

Root і nested operations використовують один execution context: Request, AbortSignal, Promise-cache request-ресурсів, cleanup і root trace. Два child-виклики повторно використовують один request-resource. Звичайні незалежні `app.execute` створюють різні scopes. Локальний `client` використовує app.execute; усередині operation для вкладеного сценарію використовуйте ctx.call.

Operation spans мають `id` і `parentId`; nested trace не губиться в окремому root trace. Приклад: [nested-trace.json](audit/nested-trace.json). Не залишайте calls без await: runtime приєднує вже розпочаті detached calls/effects перед cleanup, але обробка їхнього Result лишається відповідальністю автора.

## Dependency-ready scheduler

Кожен resource має memoized Promise на execution context. Він починає open відразу після завершення **своїх** dependencies. Повільна сусідня гілка не затримує готову наступну гілку. Рівні, використані при побудові топологічного порядку, більше не є runtime-бар’єрами.

При partial failure runtime чекає вже розпочаті dependencies та nested calls, потім закриває успішно відкриті request-ресурси у зворотному **статичному топологічному порядку**, незалежному від випадкового порядку завершення siblings. Детермінізм порядку між незалежними вузлами задає обхід декларацій.

AbortSignal перевіряється перед відкриттям ресурсу, перед і після run; передається nested calls і open. Уже запущене довільне I/O неможливо насильно перервати: resource та бізнес-код мають передавати signal до своїх API. Ін’єктовані затримки реагують на abort. Cleanup виконується і після cancellation.

## Scopes та межі гарантій

Application може залежати тільки від application. Request може залежати від обох scopes. Request scope тепер означає **один root execution context із усіма вкладеними ctx.call**, а не кожен child окремо.

Визначення needs/calls/errors заморожуються після успішної compilation. Не змінюйте публічні масиви application, схеми чи маршрути після compile. Capability-модель не є sandbox JavaScript: прямі імпорти й globals можуть обходити граф. Compiler не аналізує тіла JS і не доводить відсутність N+1.

`close(value)` не отримує результат операції. Framework не реалізує автоматичний commit/rollback. Частково створений усередині невдалого open ресурс має прибирати сам open.

## Errors та observability

Errors підтримують старий запис `NOT_FOUND: 404` та `{ status: 404, details: Schema }`. Operation-local `fail` звужує допустимий код і тип details; runtime перевіряє details й output. OpenAPI описує error body та використовує oneOf для кількох errors з однаковим status.

Метрики накопичуються незалежно від bounded traces. Є lifetime outcomes `ok`, `business_error`, `fault`, `cancelled`, total/active/peak, rolling RPM/RPS і p50/p95/p99 за часовим вікном. Root outcome враховує cleanup. Nested operations також мають власні лічильники; сума по всіх operations не є кількістю HTTP ingress.

SSE `/api/events` передає operation, resource, queue/worker і metrics events. Архітектурою лишається IR; events лише накладають поточну активність. Повільний SSE-споживач відключається, polling лишається fallback. Події не мають replay/durable delivery.

## Compile analysis

`graph.analysis` містить fanOut, dependencyCount, dependents/blastRadius, declaredEstimateMs, compilerDerivedCriticalPathMs, budgetMs і warnings.

Estimate-модель: власна declared cost + max шлях залежностей/CALLS. Це умовна структурна оцінка за метаданими, а не гарантована нижня межа runtime latency: application-вузли враховуються в графі, хоча їхній open не повторюється на кожний execution. Послідовні calls, умовні гілки та тривалість методів із JS не виводяться. Відсутня оцінка на шляху дає null. Budget warning порівнює саме цю модель із declared budget. Scope-review warning є рекомендацією, scope leak — compilation error. Це не runtime measurement і не прогноз пропускної здатності. Dependents/blastRadius зараз обходять тільки DEPENDS_ON/CALLS; route ingress і schedule TRIGGERS потребують окремого аналізу для повного operational impact.

## Карта реалізації

`core.ts` — визначення, compiler/lifecycle/execution; `analysis.ts` — статичні оцінки; `metrics.ts` — accumulator; `runtime-adapters.ts` — workers/schedules; `schema.ts` та `generator.ts` — contracts/corpus; `http.ts`, `transports.ts` — адаптери; `stand.ts`, `load.ts`, `test-spec.ts`, `stand-ui.ts` — стенд.

## Browser, server та shared: один IR v3

Нейтральний compiler додає runtime targets і partitions до спільного graph. Нові kinds: contract, state, derived, web-resource, action, view, binding, remote-endpoint; relations DERIVES, BINDS, REMOTE_CALLS, INVALIDATES. Shared contracts мають estimateMs=0; server analysis не вдає аналіз JS bodies чи точне прогнозування browser render cost.

Browser dataflow має microtask batching, dependency-first derived propagation і binding updates без повторного setup. [Scheduler](web/state-and-derived.md), [lifecycle view](web/views.md), [boundaries](fullstack/runtime-boundaries.md), [migration IR v3](migration-0.3.md). Server lifecycle вище застосовується до server partition; browser використовує start/mount/unmount/dispose.

Frontend implementation guide: [state → resource/action → bindings/view](web/writing-frontend.md), [browser lifecycle](web/lifecycle.md), [tests](web/testing.md). Кореневий Workspace у src/ реалізує цю модель для users/orders; це основний проєкт, а Counter/Tasks у examples/ — навчальні vertical slices.
