# Cross-runtime tracing

Event binding створює trace ID; action отримує його, remote пересилає x-arc-trace-id та x-arc-parent-span. Server root operation використовує той самий ID і parent link, а resource/effect spans лишаються під нею. Invalidation reload отримує action trace; resource state переносить його до DOM bindings.

```text
trace abc
browser tasks.create.submit
  remote tasks.create.submit.remote
    server tasks.create → tasks.repository
  tasks.list.query.invalidate
    remote tasks.list.query.remote
      server tasks.list → tasks.repository
  tasks.list.query → прив’язка списку на сторінці
```

Передавайте ctx.trace явно через async boundaries; ctx.set переносить trace на local state. Browser не має прихованого AsyncLocalStorage. Незв’язані програмні writes без trace можуть почати окрему activity.

Коли `mutation.update` застосовує підтверджену відповідь, кожен змінений query отримує подію `resource.updated` під trace і span мутації. Поля `data.snapshot` та `data.cache` показують, куди записано зміну. Якщо зміна вперше застосувалася до відповіді вже запущеного читання, подія має `data.replayed: true`. Відсутні дані й оновлення, яке повернуло попереднє значення, самі по собі події не створюють.

`telemetryTransport()` batches browser events у POST /_arc/telemetry, Stand отримує їх через SSE разом із server telemetry. Browser events — недовірені debugging дані; endpoint не призначено для відкритого production telemetry ingestion.

Stand interaction показує action/resource/remote/binding durations і server spans. Remote duration включає fetch/network/server/serialization; це не ізольована network latency. Browser та server clocks не синхронізуються; total action duration — browser measurement. Production distributed tracing, clock correction, sampling і durable storage не реалізовані.
