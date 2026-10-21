# @arc/framework 0.2

ARC: executable architecture graph, operations/resources/capabilities, explicit needs/calls, contracts, dependency-ready execution, Stand.

Package exports: compiled ESM `dist/index.js`, types `dist/index.d.ts`, bin `arc.mjs` → compiled CLI. Production runtime не потребує tsx. Node.js 22.18+. Opt-in condition `arc-source` адресує TypeScript source для workspace development.

Lifecycle: `await app.compile(); await app.start(); await app.execute(id,input); await app.close();`. `activate()` — alias start; graph/inspect не відкривають ресурси.

У workspace: `npm run build`, `npm test`, `npm run test:distribution`. Документація в репозиторії: [посібник](../docs/README.md), [API](../docs/api.md), [аудит і міграція](../docs/audit/README.md).
