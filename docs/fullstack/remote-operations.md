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

`remote(contract,{id,from?,input?,baseUrl?,fetch?})` створює web resource. `data()` повертає output projection, `result()` — typed RemoteResult union. `remoteClient(contract,{id,...})` — explicit graph endpoint для mutations; додайте його до action.needs. `remoteCall(contract,input,{signal,trace,telemetry,...})` — низькорівневий виклик; graph relation при його використанні треба оголосити через remoteClient/needs, compiler не читає тіло run.

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

`users()` повертає поточний знімок із `data`, `loading`, `error` та `stale`. Пряме читання в реактивному JSX додає запит до графа сторінки. Для читання, прихованого всередині допоміжної функції, запит можна додати через `needs`. `mutation` приймає цей самий запит у `refresh`. За замовчуванням ID має вигляд `<ID операції>.query`. Для контракту з обов’язковим входом передайте функцію `input`.

## Форма, що викликає операцію

Для іменованої форми вкажіть у HTML ті самі імена, що й у контракті, та передайте `mutation` в `onSubmit`.

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

Під час submit ARC читає значення через `FormData`, обрізає зовнішні пробіли й перетворює значення полів типу `number` та `integer` за схемою операції. Порожній рядок у числовому полі не стає нулем. Перед запитом ARC перевіряє весь вхід за контрактом. `addTask()` повертає знімок дії з `running`, `result` і `error`.

Якщо значення потрібне в інтерфейсі до submit, додайте `bind:value` до іменованого поля. Після успіху ARC скидає незмінене поле й прив’язаний стан до початкового значення. Для власного перетворення даних можна явно задати `fields`.

`mutation.failed(code)` перевіряє конкретну бізнес-помилку. TypeScript приймає лише коди з контракту. Наприклад, у реактивному JSX `aria-invalid={addUser.failed("EMAIL_EXISTS")}` позначає поле email після відмови сервера. Перевірка скидається при наступному надсиланні.

`mutation.invalid(field)` перевіряє, чи не пройшло поле вхідну валідацію перед запитом. Ім’я поля TypeScript бере зі схеми входу. Наприклад, `aria-invalid={createOrder.invalid("quantity")}` позначає кількість, а JSX поруч із полем може показати власне повідомлення. Щоб браузер передав надсилання ARC навіть із невалідним значенням, додайте до форми `novalidate`.

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

`fields` задає початкові рядкові значення. Опис `{ initial, parse }` перетворює поле на тип, якого вимагає контракт. Для рядкового поля без перетворення достатньо вказати початковий рядок. Якщо перетворення залежить від кількох полів, задайте початкові рядки та один `input`. Значення поля можна читати як `addTask.fields.title()` або прив’язати через `bind:value`. ID дії за замовчуванням має вигляд `<ID операції>.submit`. Для кількох форм з одним контрактом задайте кожній власний `id`. Після успіху форма повертає надіслані поля до початкових значень, якщо користувач не змінив їх під час запиту. Помилка доступна через `addTask().error`, а залежності для додаткового стану можна оголосити в `needs`. Stand показує дію, мережевий виклик і зв’язки з ресурсами з `refresh`.

## Спільний клієнт для читання та запису

```ts
const orderClient = remoteApi({
  from: [selectedUser],
  headers: (userId) => ({ authorization: `Bearer ${userId}` }),
});
const orders = orderClient.query(ListOrders, {
  cache: true,
});
const createOrder = orderClient.mutation(CreateOrder, {
  refresh: [orders],
});
```

У Workspace зміна джерела в `from` оновлює запити читання, а форма використовує актуальне значення для наступного надсилання. `query` виводить ID як `<ID операції>.query`. Для контракту з обов’язковим входом передайте функцію `input`. [Форма замовлень](../../examples/workspace/orders/page.tsx)

`cache: true` автоматично будує ключ із усіх значень `from`, тож зміна користувача ізолює результати без окремого `key`. Якщо кілька запитів мають спільний нестандартний ключ, задайте `key` у `remoteApi`; локальний `key` запиту його перевизначає. Значення `from` за замовчуванням мають бути примітивами або звичайними JSON-подібними даними; для інших типів укажіть власний `key`. При зміні ключа ARC відкидає відповіді попереднього ключа. Кеш одразу показує останній успішний результат для нового ключа, якщо він є, і завантажує свіжі дані у фоні. Під час фонового запиту `loading` і `stale` мають значення `true`. Кеш тримає до 32 ключів у пам’яті та очищається разом із запитом.

## Дія без форми

```tsx
const cancelOrder = orderClient.mutation(CancelOrder, { refresh: [orders] });

<button type="button" onClick={() => cancelOrder.run({ id: order.id })}>
  Скасувати
</button>
```

`run(input)` приймає вхід із контракту й перевіряє його перед запитом. Стан дії, бізнес-помилки, `onSuccess` і `refresh` працюють так само, як у формі. Прямий виклик із `onClick` продовжує трасу кліку у Stand.

Для дій над рядками задайте ключ через `key: ({ id }) => id`. Тоді `cancelOrder.pending(order.id)` показує, чи триває виклик для цього рядка, включно з оновленням запитів із `refresh`. Повторний `run` із тим самим ключем повертає той самий Promise, а інші ключі можуть виконуватися паралельно.

`cancelOrder.failed("ORDER_ALREADY_CANCELLED", order.id)` перевіряє бізнес-помилку конкретного рядка. `cancelOrder.outcome(order.id)` повертає його останній результат і помилку або `undefined` до завершення виклику. Новий запуск очищає попередній результат лише для свого ключа.

```tsx
<button
  type="button"
  disabled={cancelOrder.pending(order.id)}
  onClick={() => cancelOrder.run({ id: order.id })}
>
  {cancelOrder.pending(order.id) ? "Скасовуємо…" : "Скасувати"}
</button>
```

## Оновлення списку з відповіді

```ts
const cancelOrder = orderClient.mutation(CancelOrder, {
  key: ({ id }) => id,
  update: orders.replaceBy("id"),
});
```

Після успіху ARC замінює наявний рядок даними з відповіді. Ключ запиту фіксується під час запуску мутації, тому навіть після перемикання користувача оновлюється його початковий список або кеш. Запит списку, який уже виконується, зберігає підтверджену зміну під час завершення. Stand показує зв’язок `UPDATES`.

Використовуйте `refresh`, коли відповідь не містить оновленого рядка або операція змінює склад списку.

## HTTP-транспорт

Server `internalTransport(app)` обслуговує POST /_arc/call/:operation. Операція повинна явно мати `expose:{web:true}` на server. Browser descriptor не надає дозволу. Input/output/error details перевіряються сервером; client також перевіряє output. Internal exception не передає stack чи raw message. AbortSignal передається fetch і request executor настільки, наскільки дозволяє HTTP disconnect.

Internal transport не замінює public REST routes. Application authorization залишається відповідальністю operation/request capabilities; exposure — дозвіл виклику, не authentication. Same-origin credentials та Origin check — MVP transport policy, не готова production identity система.

Практика у frontend Workspace: [feature guide](../web/writing-frontend.md), [forms та error UI](../web/forms-and-events.md), [Workspace](../workspace-app.md). HTTP status використовується transport; typed business Result не гарантує окремого status поля.
