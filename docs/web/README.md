# Frontend на ARC Web

ARC Web описує frontend як явний reactive graph: local state → derived values → DOM bindings. View setup виконується один раз на mount, далі оновлюються лише залежні bindings. Network data має окрему resource semantics, mutations — action semantics.

| Посібник                                         | Для чого                                             |
| ------------------------------------------------ | ---------------------------------------------------- |
| [Початок роботи](getting-started.md)             | Запустити pure Web або frontend кореневого проєкту   |
| [Як писати frontend](writing-frontend.md)        | Додати feature від contracts до view і browser entry |
| [State та derive](state-and-derived.md)          | Explicit dependencies, batching, scheduler           |
| [Actions та resources](actions-and-resources.md) | Async state, cancellation, invalidation              |
| [Views та bindings](views.md)                    | Text/property/event/visibility без VDOM              |
| [Input і форми](forms-and-events.md)             | Native forms, validation, submit, typed errors       |
| [Lifecycle та scopes](lifecycle.md)              | Start/mount/unmount/dispose, ownership               |
| [Тестування frontend](testing.md)                | Reactive, DOM та real-HTTP integration tests         |

[ARC Workspace](../workspace-app.md) — реальний root application у `src/`; [Counter](../../examples/web-counter/page.ts) — малий pure-Web example; [Tasks](../../examples/fullstack-tasks/page.ts) — малий fullstack example. [Remote operations](../fullstack/remote-operations.md) описує browser/server boundary.

Для frontend розробника рекомендований шлях: початок роботи → як писати frontend → форми → lifecycle → тести. Backend окремо: [Server](../server/README.md).

Зараз package один: імпорти `@arc/framework/web`, `/core`, `/fullstack`. Окремих npm packages `@arc/web` чи `@arc/core` ще немає. SSR, router, forms framework, advanced cache та HMR не реалізовані.
