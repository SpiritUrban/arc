# Технічний аудит та зміни ARC 0.2

## Початковий аудит

Перевірено framework/src, 11 початкових tests, docs та package configuration до внесення змін. Основну operation/resource/capability модель збережено; зміни виконані в наявному compiler/runtime, із виділенням окремих допоміжних модулів.

Правильно працювали explicit needs, транзитивний обхід залежностей, cycles/scope leaks, memoization request-resource, input/output validation, Result errors і cleanup partial failure. Початкові 11 тестів проходили. Документація здебільшого точно визнавала обмеження, але відповідала прототипу, а не вимогам audit-запиту.

Виявлені прогалини:

- compile відкривав application resources; graph/inspect були небезпечними для offline inspection.
- IR описував лише operation/resource dependencies; calls, transport lifecycle та nested scopes не моделювалися.
- Execution чекав бар’єра всього рівня DAG.
- Business errors не мали строгої локальної типізації/details contracts.
- Метрики губили виклики разом із trace eviction; injection application methods не працювала.
- Input/test/load інструменти були мінімальними; package потребував TypeScript loader.
- Початковий тест із назвою undeclared errors фактично не перевіряв неоголошений код. Не було tests для concurrent lifecycle, cancellation або clean distribution.

## API compatibility та міграція

Обов’язкова зміна: **compile → start → execute → close**. Execute не активує application приховано. `activate()` є alias start. CLI і test harness мігровані автоматично; програмний користувацький bootstrap має додати start.

Збережені: числові errors, global error/ok, resource/capability, needs, маршрути, feature modules, client, RPC, базові Stand endpoints. Legacy queue/schedule helpers після start знаходять або явно додають graph-backed transports. Для offline IR рекомендується декларативна форма у application({queues,schedules}) до compile.

Додані: errors із details schema та typed fail; declared calls + ctx.call; transport/effect nodes і typed edges; IR version 2; explicit async instrumentation; independent metrics; test specs; SSE. Старий IR plan-масив рівнів замінений об’єктом dependency-ready plan. Старі tools, що парсили IR v1, потрібно оновити.

Production exports тепер ведуть на compiled ESM/declarations. `arc-source` — opt-in condition для workspace development. Перед compiled CLI потрібен build; tsx не є runtime dependency пакета.

## Реалізовано

| Вимога       | Результат                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| P0.1         | Pure compile, explicit start/activate, activation rollback, concurrent lifecycle                             |
| P0.2         | operation/resource/http-route/queue/worker/schedule/effect IR nodes; typed relations                         |
| P0.3         | Declared ctx.call, CALLS edges, shared Request/signal/request resources, parent-linked spans, cycle guards   |
| P0.4         | Dependency-ready Promise scheduler, once-per-context resources, deterministic reverse-topological cleanup    |
| P0.5         | Typed codes/details через fail, runtime validation, OpenAPI error schemas/oneOf                              |
| P1.6         | Детермінований schema-aware corpus із boundaries/invalid/edge inputs                                         |
| P1.7         | Fixed/generated, count/duration/concurrency/RPS/ramp, adaptive breaking brackets, три окремі benchmark modes |
| P1.8         | Окремі lifetime/window metrics, outcomes, active/peak, p50/p95/p99, незалежні від traceLimit                 |
| P1.9         | Явні async-method effect boundaries; latency/timeout/error/unavailable injection                             |
| P1.10        | Scratch + export/import/persist JSON specs, opt-in Request credentials, matchers, server hooks               |
| P2.11        | Declared/derived estimate separation, fan-out, dependency count, warnings/budgets, dependents/blast radius   |
| P2.12        | SSE operation/resource/queue/worker/metrics events і activity overlay, polling fallback                      |
| Package/docs | Compiled ESM/.d.ts/bin, clean-install smoke та синхронізовані посібники                                      |

## Гарантовані invariants

- Compile і graph не викликають open/run/sample чи schedule input callbacks. Top-level код entrypoint лишається кодом застосунку.
- Execute починається лише після успішного start; concurrent start не дублює відкриття.
- Вузли мають унікальні ID; dependency/call cycles та application → request scope leaks відхиляються до activation.
- Calls дозволені тільки через declared names. Один root context переносить Request/signal і кеш request-resources у всі nested calls.
- Кожна dependency створюється максимум один раз на context; готова гілка не чекає unrelated siblings.
- Уже початі calls/effects/resource opens приєднуються до cleanup; залежні ресурси закриваються раніше своїх dependencies. Cleanup намагається закрити й решту ресурсів після окремої помилки.
- Input/output/error details перевіряються runtime. Type tests доводять відхилення unknown codes/details і неправильного child input.
- Метрики не залежать від retention debugging traces. Root cleanup failure є fault, а не ok.
- Instrumentation не патчить довільний JS: тільки явно названі async-method boundaries.

## Приклад Architecture IR

Повний generated JSON: [architecture-ir.json](architecture-ir.json), без runtime activation під час формування.

```json
{
  "version": 2,
  "nodes": [
    { "id": "parent", "kind": "operation" },
    { "id": "read", "kind": "operation" },
    { "id": "session", "kind": "resource", "scope": "request" },
    { "id": "http:GET:/demo", "kind": "http-route" },
    { "id": "jobs", "kind": "queue" },
    { "id": "worker:jobs", "kind": "worker" },
    { "id": "refresh", "kind": "schedule" }
  ],
  "edges": [
    { "from": "parent", "to": "session", "kind": "DEPENDS_ON" },
    { "from": "read", "to": "session", "kind": "DEPENDS_ON" },
    { "from": "parent", "to": "read", "kind": "CALLS" },
    { "from": "http:GET:/demo", "to": "parent", "kind": "ROUTES_TO" },
    { "from": "worker:jobs", "to": "jobs", "kind": "CONSUMES" },
    { "from": "worker:jobs", "to": "read", "kind": "CALLS" },
    { "from": "refresh", "to": "read", "kind": "TRIGGERS" }
  ]
}
```

Скорочений приклад вище опускає contracts/plans/analysis. `EMITS` зарезервовано; автоматичного producer-edge для довільного enqueue немає.

## Приклад nested trace

Фактичний запис: [nested-trace.json](nested-trace.json). Root parent викликає `call('read', {})`; обидві operations потребують session:

```text
parent [operation]
├─ session [resource.open]  ← рівно одне відкриття
└─ read    [operation]     ← parentId вказує на span parent
```

Root trace один. Read не відкриває session повторно. Spans у JSON записані за завершенням, дерево відновлюється через id/parentId. Результат/Request bodies у trace не записуються автоматично.

## Scheduler benchmark

Відтворення: `npm run benchmark:scheduler`. [Виміряний JSON](scheduler-benchmark.json). Старий level-barrier algorithm відтворено у benchmark harness, новий scheduler виконує реальну ARC operation.

DAG: slow=80 ms; fast=5 ms; child(fast)=80 ms; operation потребує slow і child. П’ять послідовних пар запусків, timers, один процес, без HTTP.

| Scheduler                    | Середня latency |
| ---------------------------- | --------------- |
| Level barrier (before)       | 160.43 ms       |
| Dependency-ready ARC (after) | 86.72 ms        |

Зменшення latency на цьому штучному DAG: **45.95%**. Це не перевага над Express/Fastify і не throughput deployment. Новий результат включає ARC validation/tracing overhead; legacy harness відтворює scheduling delays без повного старого runtime.

Evidence генерує `node --conditions=arc-source --import tsx scripts/audit-evidence.ts`; benchmark збережено окремо. UUID, час і duration у повторному запуску відрізнятимуться.

## Валідація

- 32 unit/integration tests.
- Окремий запуск 12 lifecycle/concurrency tests.
- 2 навчальні docs tests.
- Typecheck, включно з docs/examples, benchmark/evidence та negative contract tests.
- Framework/root build.
- Packed clean-project plain-node import, offline CLI graph, execution без tsx; strict TypeScript consumer declarations.
- Реальний network load і SSE через Node bridge, не лише локальний handler.
- Stand client script syntax, persistence/export redaction, schema corpus, bounded-trace-independent metrics.

Візуальна browser QA не входить до наведених перевірок: інтерактивні сценарії перевірено на API/stream/client-script рівнях.

## Roadmap та межі

- Random/property-based generation, shrinking, domain-aware fixtures. Corpus наразі one-field-at-a-time, не повний Cartesian product.
- Стійкі queues, retries/delivery guarantees, distributed workers, cron expressions та production ingress/RBAC.
- Явні queue producer/EMITS декларації; повний graph event/effect model між процесами.
- Реальний DB disconnect adapter: unavailable/timeout зараз симулюють boundary-відмову перед викликом, не закривають pool і не обривають довільне I/O.
- Metrics histogram/exporter для високого traffic, OpenTelemetry, durable history/SSE replay та reconnect recovery. Поточні percentile samples обмежені часом, але не кількістю.
- Calibrated estimates, повні scenario/what-if симуляції, architecture diff. Статична модель не аналізує JS bodies; derived estimate не є виміряним p95.
- Зовнішній load-agent для deployment capacity, довші статистичні серії breaking point і resource-specific saturation counters.
- TypeScript test generation/YAML; JSON specs і hooks уже працюють. Автоматичний reset arbitrary state не гарантується.
- Повний JSON-RPC batch/notification compliance та frontend network SDK.
