# ARC 0.2 → 0.3

Server source API і lifecycle збережені. Root import лишається server API; browser imports використовуйте через `/core`, `/web`, `/fullstack`. Фізично це один @arc/framework package; окремі @arc/core/server/web/fullstack/stand npm packages поки не опубліковані.

IR version змінено з 2 на 3. Кожний node має runtime; додані contract/state/derived/web-resource/action/view/binding/remote-endpoint, DERIVES/BINDS/REMOTE_CALLS/INVALIDATES. Shared input/output contract nodes додаються навіть у server-only IR, тому кількість nodes/edges може змінитися. Споживачі IR повинні перевіряти version і не припускати закритий набір kinds. Execution plans та server dependency semantics збережені.

Module/application тепер приймають web:{nodes,entry,serverModules?}. Старі operations/resources config залишаються. Browser remote потребує explicit server expose.web; раніше internal ARC web transport не існував. Build tooling потребує esbuild, звичайний server consumer — ні.
