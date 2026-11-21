# Stand для єдиного application graph

`npm run dev:fullstack-tasks` відкриває app :3000 і Stand :3100. Graph filters All / Frontend / Backend / Boundaries працюють поверх одного IR v3. Node target позначено візуально; declared edges — архітектура, підсвічена runtime activity — спостережені виконання, а не нове джерело graph.

Stand розкладає граф за напрямком залежностей. Стрілки вказують джерело й ціль, пунктир показує віддалені виклики. Натисніть вузол, щоб підсвітити вхідні та вихідні зв’язки. Кнопка «Увесь граф» підбирає масштаб для огляду.

Graph показує browser state → action → remote boundary → server operation → repository та web resource → binding → view. Browser metrics містять calls/running/success/business errors/faults/cancelled, rolling p50/p95, binding updates/last duration. Interaction trace об’єднує browser events і server spans за trace ID. Browser actions запускаються з application UI; server runner і reusable tests залишаються у Stand.

SSE — live push, polling — fallback. Trace buffers bounded; server accumulator незалежний від trace eviction. Browser telemetry best-effort, обмежене debugging storage; не production monitoring.

[Server Stand/testing](../testing-and-stand.md), [межі trace measurements](../fullstack/tracing.md), [звіт і graph](../audit/web-fullstack-report.md).

Для основного Workspace запускайте npm run dev:workspace. Його graph містить users/orders frontend та backend; вибір користувача, users.create.submit і orders.create.submit створюють activity через відповідні remote boundaries. [Workspace frontend tests](../web/testing.md) зіставляють browser action із server operation за trace ID.
