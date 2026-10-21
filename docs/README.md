# Документація ARC 0.3

ARC — application graph framework/compiler для server, browser та fullstack applications. Операція містить контракт і бізнес-логіку, ресурси надають їй залежності, а HTTP, RPC та черга викликають операцію через спільний executor.

Цей посібник описує **поточну реалізацію** в `framework/` і застосунок ARC Workspace у `src/`. Початкове обговорення ідей збережене в [`doc.md`](../doc.md); воно містить також можливості, які ще не реалізовані.

| Розділ                                   | Що ви дізнаєтесь                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| [Початок роботи](getting-started.md)     | Встановлення, запуск, CLI, структура репозиторію                           |
| [Архітектура](architecture.md)           | Граф, компіляція, execution plan, scopes, lifecycle та telemetry           |
| [Server: як писати код](writing-code.md) | Контракти, операції, ресурси, помилки, модулі та завершений приклад        |
| [Довідник API](api.md)                   | Параметри публічних функцій, HTTP, RPC, черга і scheduler                  |
| [Тести та Stand](testing-and-stand.md)   | Підміна залежностей, HTTP-тести, traces, навантаження та failure injection |

Для кореневого застосунку почніть із [ARC Workspace](workspace-app.md). Для frontend: [Web index](web/README.md) → [як писати frontend](web/writing-frontend.md) → [форми](web/forms-and-events.md) → [тести](web/testing.md). Для backend: початок роботи → як писати server код → тести. Архітектура пояснює внутрішню модель, довідник допомагає знайти точний виклик API.

## Приклади, які можна запустити

- [`src/app.ts`](../src/app.ts) — основний fullstack застосунок ARC Workspace: користувачі та замовлення.
- [`examples/tasks.ts`](examples/tasks.ts) — самодостатній приклад feature-модуля завдань.
- [`examples/tasks.test.ts`](examples/tasks.test.ts) — тести прикладу без підняття HTTP-сервера.

З кореня репозиторію:

```sh
npm run build
ARC_APP=docs/examples/tasks.ts npx arc stand
node --conditions=arc-source --import tsx --test docs/examples/tasks.test.ts
```

Усі приклади використовують ESM та імпорти з `@arc/framework`. У кореневому застосунку й навчальних прикладах відносні TypeScript-імпорти мають `.ts`; compiler переписує їх у JS build. Усередині `framework/src/` використовуються NodeNext-імпорти `.js`, які працюють і в source development, і в compiled package/declarations. Production import пакета веде на compiled ESM.

[Звіт розширення ARC 0.3](audit/web-fullstack-report.md), [історичний аудит 0.2](audit/README.md), [IR v3 migration](migration-0.3.md).

## Версії та міграція

[Перехід з ARC 0.1 на 0.2](migration-0.2.md) містить зміни bootstrap, IR, calls, errors, transports і package imports. [Звіт аудиту](audit/README.md) є зафіксованим результатом перевірки, а не автоматично оновлюваним test dashboard. `doc.md` — історичний архів концепції; джерело актуального API — цей посібник і `framework/src/`.

## Web і Fullstack

- [ARC Server](server/README.md)
- [ARC Web: усі frontend посібники](web/README.md), [початок](web/getting-started.md), [state/derive](web/state-and-derived.md), [actions/resources](web/actions-and-resources.md), [views](web/views.md)
- [Fullstack](fullstack/overview.md), [remote](fullstack/remote-operations.md), [boundaries](fullstack/runtime-boundaries.md), [tracing](fullstack/tracing.md)
- [Fullstack Stand](stand/README.md), [IR migration 0.3](migration-0.3.md), [результати реалізації](audit/web-fullstack-report.md)

Server посібники зберігають приклади root imports; browser code використовує package subpaths.

[ARC Workspace: як запустити та як влаштований кореневий проєкт](workspace-app.md).
