# Runtime boundaries та browser build

Стандартні targets: state/derived/action/view/binding/web-resource/remote-endpoint — browser; operation/resource/HTTP/queue/worker/schedule/effect — server; contract/pure — shared. Directory layout не визначає target.

Compiler відхиляє browser → server direct dependency, shared → runtime-specific dependency, duplicate IDs, reactive cycles, invalid dependencies, non-exposed remote і несумісний operation contract. Diagnostic містить graph path; ARC201 рекомендує remote або shared logic.

Shared contract не означає shared runtime values. Server resource state, secrets та config не серіалізуються в browser.

Рекомендований шлях — shared `operationContract`. Альтернатива direct `remote(serverOperation)` підтримується build tooling через явний `web.serverModules` allowlist: esbuild plugin на build host замінює exports operation модуля serializable contract descriptors. Модуль може експортувати лише відомі exposed operations; repository лишається private. Сам import build host виконує top-level JS: не підключайте DB у module scope.

`buildWeb` використовує optional peer esbuild, graph entrypoints та manifest. Browser imports Node builtins/server runtime відхиляються. Build tests перевіряють metafile та відсутність secret sentinel. Це не загальний аналіз усіх довільних JS secrets: author не повинен вручну імпортувати secret у browser code. Server ESM збирає TypeScript, ARC не пише власний bundler.

Package subpaths `/core`, `/web`, `/fullstack` browser-safe. `/server`, `/fullstack/server`, `/fullstack/build`, `/stand` призначені Node tooling/runtime. Нейтральний core окремо typechecked без DOM/Node libraries.
