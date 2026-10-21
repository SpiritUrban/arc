# Actions і зовнішні resources

`action({id,input?,needs?,invalidates?,run})` представляє mutation. `execute(input,{trace?})` повертає результат run; running/error/result — readable projections. Snapshot має idle/running/success/error. Input schema перевіряється перед run. Exceptions відхиляють execute, ARC Result з business error зберігається як результат. Передавайте `{signal,trace}` з run у remote client; `ctx.set(state,value)` переносить trace до bindings.

Dependencies оголошуються через needs, автоматична інспекція JS closures відсутня. Після успішного Result або звичайного return, resources з invalidates reload; IR містить INVALIDATES. Одночасні executions дозволені, result/status представляє останній запуск; для UI serialization використовуйте running/disabled.

`webResource({id,from,input,load,scope?})` — projection зовнішнього source of truth, а не local state. from задає inspectable reactive dependencies, input отримує їхні значення. load отримує AbortSignal і trace. API: data/loading/error/stale, get(), refresh(), invalidate(), activate(), dispose(). Application.start активує application resources, mount — view-owned resources.

При новому input попередній controller abort; generation guard блокує пізній старий результат навіть якщо loader ігнорує signal. Dispose відписує dependencies, abort pending load та прибирає projections. Помилки input/load потрапляють у snapshot fault. Модель кешу MVP: один instance, поточний input/result; немає TTL, durable cache чи дедуплікації між instances.

Network data слід завантажувати через resource, mutations — через action, pure values — derive, DOM — binding. Універсального useEffect-подібного механізму немає. [Remote contracts](../fullstack/remote-operations.md) зберігають success/business_error/fault/cancelled union.
