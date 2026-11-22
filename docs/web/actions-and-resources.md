# Actions і зовнішні resources

`action({id,input?,needs?,invalidates?,run})` представляє mutation. `execute(input,{trace?})` повертає результат run; running/error/result — callable projections (`running()`, `error()`, `result()`). Snapshot має idle/running/success/error. Input schema перевіряється перед run. Exceptions відхиляють execute, ARC Result з business error зберігається як результат. Передавайте `{signal,trace}` з run у remote client; `ctx.set(state,value)` переносить trace до bindings.

Дію без вхідних даних можна передати в кнопку напряму: `<button onClick={refresh}>Оновити</button>`. Для форми використовуйте `<form onSubmit={save}>`; обидва варіанти також підтримують `on:click` і `on:submit`.

Dependencies оголошуються через `needs`: один вузол передається напряму (`needs: user`), кілька — масивом або об’єктом із назвами. Автоматична інспекція JS closures відсутня. Після успішного Result або звичайного return, resources з invalidates reload; IR містить INVALIDATES. Одночасні executions дозволені, result/status представляє останній запуск; для UI serialization використовуйте running/disabled.

`webResource({id,from,input,load,scope?})` — projection зовнішнього source of truth, а не local state. from задає inspectable reactive dependencies, input отримує їхні значення. load отримує AbortSignal і trace. API: data/loading/error/stale, get(), refresh(), invalidate(), activate(), dispose(). Application.start активує application resources, mount — view-owned resources.

При новому input попередній controller abort; generation guard блокує пізній старий результат навіть якщо loader ігнорує signal. Dispose відписує dependencies, abort pending load та прибирає projections. Помилки input/load потрапляють у snapshot fault. Модель кешу MVP: один instance, поточний input/result; немає TTL, durable cache чи дедуплікації між instances.

Network data слід завантажувати через resource, mutations — через action, pure values — derive, DOM — binding. Універсального useEffect-подібного механізму немає. [Remote contracts](../fullstack/remote-operations.md) зберігають success/business_error/fault/cancelled union.

## Resource залежно від вибраного користувача

У [сторінці замовлень](../../examples/workspace/orders/page.tsx) клієнт `remoteApi` бере вибраного користувача зі [спільного стану](../../examples/workspace/user-selection.ts). Залежність `from` запускає нове завантаження після зміни вибору. Клієнт додає UUID користувача до заголовка `Authorization`, а серверний ресурс `currentUser` читає його для поточного запиту.

Cached data попереднього input може залишатися під час loading. Workspace visibleOrders додатково фільтрує data за selectedUser, щоб до завершення нового load не показувати чужу projection. При invalidation того самого input попередній список може залишатися видимим до reload.

Action.run отримує signal/trace/set; remoteClient.call(input,ctx) переносить signal/trace. Після success invalidates await reload, тому action Promise завершиться після нього. Projection running відображає поточний action snapshot, а не гарантує очікування всіх довільних background tasks.

[Практичний feature](writing-frontend.md) · [Submit і business errors](forms-and-events.md) · [Lifecycle](lifecycle.md).
