# Stand для єдиного application graph

`npm run dev:fullstack` відкриває app :3000 і Stand :3100. Graph filters All / Frontend / Backend / Boundaries працюють поверх одного IR v3. Node target позначено візуально; declared edges — архітектура, підсвічена runtime activity — спостережені виконання, а не нове джерело graph.

Graph показує browser state → action → remote boundary → server operation → repository та web resource → binding → view. Browser metrics містять calls/running/success/business errors/faults/cancelled, rolling p50/p95, binding updates/last duration. Interaction trace об’єднує browser events і server spans за trace ID. Browser actions запускаються з application UI; server runner і reusable tests залишаються у Stand.

SSE — live push, polling — fallback. Trace buffers bounded; server accumulator незалежний від trace eviction. Browser telemetry best-effort, обмежене debugging storage; не production monitoring.

[Server Stand/testing](../testing-and-stand.md), [межі trace measurements](../fullstack/tracing.md), [звіт і graph](../audit/web-fullstack-report.md).
