# ARC Server

Server API залишається сумісним: root `@arc/framework` або `@arc/framework/server`. Browser runtime не потрібен. `compile → start → execute → close`, explicit needs/calls, dependency-ready resource DAG, typed business errors, HTTP/RPC/queue/schedule збережені.

[Написання server коду](../writing-code.md) · [API](../api.md) · [Lifecycle/архітектура](../architecture.md) · [Тести та Stand](../testing-and-stand.md). Кореневий `src/` — fullstack Workspace зі збереженим server API; docs/examples/tasks.ts — малий server-only feature module.
