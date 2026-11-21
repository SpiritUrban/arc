# Frontend на ARC Web

ARC Web описує frontend як явний reactive graph: local state → derived values → DOM bindings. ARC знаходить bindings у TSX до mount. Після монтування оновлюються лише прив’язані ділянки DOM. Network data має окрему resource semantics, mutations — action semantics.

| Посібник                                         | Для чого                                             |
| ------------------------------------------------ | ---------------------------------------------------- |
| [Початок роботи](getting-started.md)             | Запустити pure Web або frontend Workspace   |
| [Як писати frontend](writing-frontend.md)        | Додати feature від contracts до view і browser entry |
| [State та derive](state-and-derived.md)          | Explicit dependencies, batching, scheduler           |
| [Actions та resources](actions-and-resources.md) | Async state, cancellation, invalidation              |
| [Views та bindings](views.md)                    | TSX-шаблони та оновлення окремих DOM-вузлів              |
| [Input і форми](forms-and-events.md)             | Native forms, validation, submit, typed errors       |
| [Lifecycle та scopes](lifecycle.md)              | Start/mount/unmount/dispose, ownership               |
| [Тестування frontend](testing.md)                | Reactive, DOM та real-HTTP integration tests         |

[ARC Workspace](../workspace-app.md) — fullstack-приклад у `examples/workspace/`; [Counter](../../examples/web-counter/page.tsx) — малий pure-Web example; [Tasks](../../examples/fullstack-tasks/page.tsx) — малий fullstack example. [Remote operations](../fullstack/remote-operations.md) описує browser/server boundary.

Для frontend розробника рекомендований шлях: початок роботи → як писати frontend → форми → lifecycle → тести. Backend окремо: [Server](../server/README.md).

Зараз package один: імпорти `@arc/framework/web`, `/core`, `/fullstack`. Окремих npm packages `@arc/web` чи `@arc/core` ще немає. Для форм зі спільним серверним контрактом використовуйте [`remoteForm`](../fullstack/remote-operations.md).
