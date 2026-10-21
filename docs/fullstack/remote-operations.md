# Remote operations

```ts
import { remote, remoteClient } from "@arc/framework/fullstack";
// ListTasks/CreateTask — shared operationContract descriptors
const tasks = remote(ListTasks, { id: "tasks.current" });
const create = remoteClient(CreateTask, { id: "tasks.create.remote" });
const result = await create.call({ title: "Read ARC" });
if (result.ok) console.log(result.value.id);
else if (result.kind === "business_error")
  console.log(result.error, result.details);
```

`remote(contract,{id,from?,input?,baseUrl?,fetch?})` створює web resource. data — output projection, result — typed RemoteResult union. `remoteClient(contract,{id,...})` — explicit graph endpoint для mutations; додайте його до action.needs. `remoteCall(contract,input,{signal,trace,telemetry,...})` — низькорівневий виклик; graph relation при його використанні треба оголосити через remoteClient/needs, compiler не читає тіло run.

RemoteResult розрізняє `{ok:true,kind:'success',value}` і `{ok:false,kind:'business_error',error,details}`, fault та cancelled. Codes/details виводяться з operation errors. Не всі помилки перетворюються на thrown exceptions.

Server `internalTransport(app)` обслуговує POST /_arc/call/:operation. Операція повинна явно мати `expose:{web:true}` на server. Browser descriptor не надає дозволу. Input/output/error details перевіряються сервером; client також перевіряє output. Internal exception не передає stack чи raw message. AbortSignal передається fetch і request executor настільки, наскільки дозволяє HTTP disconnect.

Internal transport не замінює public REST routes. Application authorization залишається відповідальністю operation/request capabilities; exposure — дозвіл виклику, не authentication. Same-origin credentials та Origin check — MVP transport policy, не готова production identity система.

Практика у кореневому frontend: [feature guide](../web/writing-frontend.md), [forms та error UI](../web/forms-and-events.md), [Workspace](../workspace-app.md). HTTP status використовується transport; typed business Result не гарантує окремого status поля.
