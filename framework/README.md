# @arc/framework

Окремий TypeScript ESM-пакет ARC. Не імпортує код кореневого застосунку. Потребує Node.js 22.18+; CLI завантажує TypeScript через залежність `tsx`.

Публічний API експортується з `src/index.ts`: schemas, operation, resource/capability, module, application, results, HTTP/OpenAPI, Stand, JSON-RPC, queue, schedule, client та test harness.

З кореня репозиторію: `npm install`, `npm run dev`, `npm test`. Детальні приклади та межі реалізації — у кореневому README.md. У власному застосунку встановіть цей каталог як локальну залежність `"@arc/framework": "file:../arc/framework"` та експортуйте application із `src/app.ts`.
