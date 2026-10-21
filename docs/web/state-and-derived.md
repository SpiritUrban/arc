# State, derive та scheduler

`state({id,initial})` — client-owned local state: get, set, update, subscribe, dispose. `derive({id,from,compute})` — кешований graph node з явними dependencies; IR містить DERIVES від source до derived. Compute має бути чистим. Compiler відхиляє declared cycles та повторні ID.

Записи синхронно змінюють state; propagation планується microtask. `batch(fn)` групує synchronous writes. Scheduler спочатку обчислює dirty derived dependencies, потім повідомляє subscriptions/bindings у deterministic порядку. Scheduled derived/binding виконується не більше одного разу на batch; DOM не отримує проміжних derived значень. `flush()` виконує propagation зараз; `await tick()` очікує її.

Імперативний `derived.get()` читає актуальне значення і може достроково recompute dirty node. Якщо читати його між кожним записом усередині batch, додаткові обчислення можливі. Гарантія одного recompute стосується scheduled propagation, а не довільних eager reads.

Синхронний початок action.run автоматично batched. Після await використовуйте окремий `batch(() => {...})` для кількох пов’язаних записів. ARC не тримає глобальну transaction відкритою під час network request.

`Scope` прибирає owned cleanup у зворотному порядку. Application nodes живуть до webApplication.dispose. View-owned nodes живуть до unmount; для незалежного state кількох view instances створюйте nodes/view у factory. Один definition object не клонується автоматично на кожний mount.

Практика: [як писати frontend](writing-frontend.md), [input bindings](forms-and-events.md), [ownership](lifecycle.md). У Workspace search — local state, filtered users — derive, usersData — remote resource; їхні semantics не взаємозамінні.
