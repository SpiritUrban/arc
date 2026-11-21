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

## Запит зі спільного контракту

```tsx
// @arc reactive-jsx
import { query } from "@arc/framework/fullstack";
import { ListUsers } from "./contracts.ts";

const users = query(ListUsers);
const status = () => (
  <p>{users().loading ? "Завантаження…" : users().data?.length}</p>
);
```

`users()` повертає поточний знімок із `data`, `loading`, `error` та `stale`. Додайте запит до графа сторінки через `needs`, щоб ARC запускав його разом із застосунком. `remoteForm` приймає цей самий запит у `refresh`. За замовчуванням ID має вигляд `<ID операції>.query`. Для контракту з обов’язковим входом передайте функцію `input`.

## Форма, що викликає операцію

Для форми з рядковими полями вкажіть у HTML ті самі імена, що й у контракті, та передайте `mutation` в `onSubmit`.

```tsx
import { mutation } from "@arc/framework/fullstack";

const addTask = mutation(CreateTask, { refresh: [tasks] });

const form = () => (
  <form onSubmit={addTask}>
    <input name="title" aria-label="Назва задачі" required />
    <button type="submit">Додати</button>
  </form>
);
```

Під час submit ARC читає значення через `FormData`, обрізає зовнішні пробіли та перевіряє дані за схемою операції перед запитом. `addTask()` повертає знімок дії з `running`, `result` і `error`. Для реактивних значень до submit або перетворення типів задайте `fields` і передайте потрібне поле в `bind:value`.

```tsx
import { mutation, textField } from "@arc/framework/fullstack";

const addTask = mutation(CreateTask, {
  fields: { title: textField() },
  refresh: [tasks],
});

const form = () => (
  <form onSubmit={addTask}>
    <input aria-label="Назва задачі" bind:value={addTask.fields.title} required />
    <button type="submit">Додати</button>
  </form>
);
```

`fields` задає початкові рядкові значення. Опис `{ initial, parse }` перетворює поле на тип, якого вимагає контракт. Для рядкового поля без перетворення достатньо вказати початковий рядок. Якщо перетворення залежить від кількох полів, задайте початкові рядки та один `input`. ID дії за замовчуванням має вигляд `<ID операції>.submit`. Для кількох форм з одним контрактом задайте кожній власний `id`. Після успіху форма повертає надіслані поля до початкових значень, якщо користувач не змінив їх під час запиту. Помилка доступна через `addTask().error`, а залежності для додаткового стану можна оголосити в `needs`. Stand показує дію, мережевий виклик і зв’язки з ресурсами з `refresh`.

## Спільний клієнт для читання та запису

```ts
const orderClient = remoteApi({
  from: [selectedUser],
  headers: (userId) => ({ authorization: `Bearer ${userId}` }),
});
const orders = orderClient.query(ListOrders);
const createOrder = orderClient.mutation(CreateOrder, {
  fields: { product: textField(), quantity: integerField(1) },
  refresh: [orders],
});
```

У [Workspace](../../examples/workspace/orders/page.tsx) зміна джерела в `from` оновлює запити читання, а форма використовує актуальне значення для наступного надсилання. `query` виводить ID як `<ID операції>.query`. Для контракту з обов’язковим входом передайте функцію `input`. `integerField` перетворює текст на число, а серверний контракт перевіряє допустимість значення.

## HTTP-транспорт

Server `internalTransport(app)` обслуговує POST /_arc/call/:operation. Операція повинна явно мати `expose:{web:true}` на server. Browser descriptor не надає дозволу. Input/output/error details перевіряються сервером; client також перевіряє output. Internal exception не передає stack чи raw message. AbortSignal передається fetch і request executor настільки, наскільки дозволяє HTTP disconnect.

Internal transport не замінює public REST routes. Application authorization залишається відповідальністю operation/request capabilities; exposure — дозвіл виклику, не authentication. Same-origin credentials та Origin check — MVP transport policy, не готова production identity система.

Практика у frontend Workspace: [feature guide](../web/writing-frontend.md), [forms та error UI](../web/forms-and-events.md), [Workspace](../workspace-app.md). HTTP status використовується transport; typed business Result не гарантує окремого status поля.
