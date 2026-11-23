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

`remote(contract,{id,from?,input?,baseUrl?,fetch?})` створює web resource. Для одного джерела `from` передається напряму, для кількох — масивом. `data()` повертає output projection, `result()` — typed RemoteResult union. `remoteClient(contract,{id,...})` — explicit graph endpoint для mutations; додайте його до action.needs. `remoteCall(contract,input,{signal,trace,telemetry,...})` — низькорівневий виклик; graph relation при його використанні треба оголосити через remoteClient/needs, compiler не читає тіло run.

RemoteResult розрізняє `{ok:true,kind:'success',value}` і `{ok:false,kind:'business_error',error,details}`, fault та cancelled. Codes/details виводяться з operation errors. Не всі помилки перетворюються на thrown exceptions.

У новому коді використовуйте `mutation` і `refresh`. `remoteForm` та опція `invalidates` у fullstack form/mutation лишаються сумісними застарілими назвами. `action({ invalidates })` у базовому Web API — окремий загальний механізм і зберігає свою назву.

## Запит зі спільного контракту

```tsx
import { query } from "@arc/framework/fullstack";
import { ListUsers } from "./contracts.ts";

const users = query(ListUsers);
const status = () => (
  <p>{users().loading ? "Завантаження…" : users().data?.length}</p>
);
```

`users()` повертає поточний знімок із `data`, `loading`, `error` та `stale`. Пряме читання в реактивному JSX додає запит до графа сторінки. Для читання, прихованого всередині допоміжної функції, запит можна додати через `needs`. `mutation` приймає цей самий запит у `refresh`. За замовчуванням ID має вигляд `<ID операції>.query`. Для контракту з обов’язковим входом передайте функцію `input`.

У файлах застосунку, що проходять через ARC CLI або browser build, reactive JSX вмикається автоматично. Pragma потрібен лише для окремої TSX-точки входу поза графом застосунку.

## Форма, що викликає операцію

Для іменованої форми вкажіть у HTML ті самі імена, що й у контракті, та передайте `mutation` в `onSubmit`.

```tsx
import { mutation } from "@arc/framework/fullstack";

const addTask = mutation(CreateTask, { refresh: tasks });

const form = () => (
  <form onSubmit={addTask}>
    <input name="title" aria-label="Назва задачі" required />
    <button type="submit">Додати</button>
  </form>
);
```

Під час submit ARC читає значення через `FormData`, обрізає зовнішні пробіли й перетворює поля `number` та `integer` за схемою операції. Checkbox для boolean-поля передає `true` або `false`, зокрема коли він не відмічений; повторені значення array-поля стають масивом, а числові елементи — числами. Невибрана checkbox-група дає `[]`. Порожній рядок у числовому полі не стає нулем. Перед запитом ARC перевіряє весь вхід за контрактом. `refresh` приймає один ресурс напряму або масив ресурсів. `addTask()` повертає знімок дії з `running`, `result` і `error`.

Якщо значення потрібне в інтерфейсі до submit, додайте `bind:value` до іменованого поля. Після успіху ARC скидає незмінене поле й прив’язаний стан до початкового значення. Для власного перетворення даних можна явно задати `fields`.

Якщо частина входу вже є в контексті форми, передайте її через `mutation.with(params)`. Наприклад, `onSubmit={updateUser.with({ id: user.id })}` бере ID з профілю, а ім’я та email читає з іменованих полів. Параметри фіксуються під час створення прив’язки, мають пріоритет над полями й параметрами мутації та проходять перевірку разом з усім входом. Прив’язка використовує стан тієї самої мутації.

`mutation.failed(code)` перевіряє конкретну бізнес-помилку. TypeScript приймає лише коди з контракту. Наприклад, у реактивному JSX `aria-invalid={addUser.failed("EMAIL_EXISTS")}` позначає поле email після відмови сервера. Перевірка скидається при наступному надсиланні.

`mutation.invalid(field)` перевіряє, чи не пройшло поле вхідну валідацію перед запитом. Ім’я поля TypeScript бере зі схеми входу. Наприклад, `aria-invalid={createOrder.invalid("quantity")}` позначає кількість, а JSX поруч із полем може показати власне повідомлення. `mutation.invalid()` повертає `true`, якщо контрактну перевірку не пройшло хоча б одне поле; ним зручно приховати загальне повідомлення про помилку, коли помилки вже показані біля полів. Щоб браузер передав надсилання ARC навіть із невалідним значенням, додайте до форми `novalidate`.

```tsx
import { mutation, textField } from "@arc/framework/fullstack";

const addTask = mutation(CreateTask, {
  fields: { title: textField() },
  refresh: tasks,
});

const form = () => (
  <form onSubmit={addTask}>
    <input aria-label="Назва задачі" bind:value={addTask.fields.title} required />
    <button type="submit">Додати</button>
  </form>
);
```

`fields` задає початкові рядкові значення. Опис `{ initial, parse }` перетворює поле на тип, якого вимагає контракт. Для рядкового поля без перетворення достатньо вказати початковий рядок. Якщо перетворення залежить від кількох полів, задайте початкові рядки та один `input`. Значення поля можна читати як `addTask.fields.title()` або прив’язати через `bind:value`. ID дії за замовчуванням має вигляд `<ID операції>.submit`. Для кількох форм з одним контрактом задайте кожній власний `id`. Після успіху форма повертає надіслані поля до початкових значень, якщо користувач не змінив їх під час запиту. Помилка доступна через `addTask().error`, а залежності для додаткового стану можна оголосити в `needs`. Stand показує дію, мережевий виклик і зв’язки з ресурсами з `refresh`.

Для іменованих полів `params` задає частину входу з контексту сторінки. Наприклад, на сторінці `/orders/:id` форма редагування може містити тільки поля товару та кількості:

```tsx
const updateOrder = own(orderClient.mutation(UpdateOrder, {
  params: { id: params.id },
  update: [order.replace(), ordersData.replaceBy("id")],
}));

return (
  <form onSubmit={updateOrder}>
    <input name="product" />
    <input name="quantity" type="number" />
    <button type="submit">Зберегти</button>
  </form>
);
```

ARC об’єднує іменовані поля з `params` і перевіряє спільний вхід за контрактом. Якщо одне ім’я присутнє в обох джерелах, пріоритет має `params`. Прямий виклик `mutation.run(input)` приймає повний вхід. Поки виконується submit, ARC автоматично вимикає кнопки надсилання цієї форми.

## Спільний клієнт для читання та запису

```ts
const orderClient = remoteApi({
  from: selectedUser,
  headers: (userId) => ({ authorization: `Bearer ${userId}` }),
});
const orders = orderClient.query(ListOrders, {
  cache: true,
});
const createOrder = orderClient.mutation(CreateOrder, {
  refresh: orders,
});
```

У Workspace зміна джерела в `from` оновлює запити читання, а форма використовує актуальне значення для наступного надсилання. `query` виводить ID як `<ID операції>.query`. Для контракту з обов’язковим входом передайте функцію `input`. [Форма замовлень](../../examples/workspace/orders/page.tsx)

`cache: true` автоматично будує ключ із усіх значень `from`, тож зміна користувача ізолює результати без окремого `key`. Якщо кілька запитів мають спільний нестандартний ключ, задайте `key` у `remoteApi`; локальний `key` запиту його перевизначає. Значення `from` за замовчуванням мають бути примітивами або звичайними JSON-подібними даними; для інших типів укажіть власний `key`. При зміні ключа ARC відкидає відповіді попереднього ключа. Кеш одразу показує останній успішний результат для нового ключа, якщо він є, і завантажує свіжі дані у фоні. Під час фонового запиту `loading` і `stale` мають значення `true`. Кеш тримає до 32 ключів у пам’яті та очищається разом із запитом.

## Дія без форми

```tsx
const cancelOrder = orderClient.mutation(CancelOrder, { refresh: orders });

<button type="button" onClick={() => cancelOrder.run({ id: order.id })}>
  Скасувати
</button>
```

`run(input)` приймає вхід із контракту й перевіряє його перед запитом. Стан дії, бізнес-помилки, `onSuccess` і `refresh` працюють так само, як у формі. Прямий виклик із `onClick` продовжує трасу кліку у Stand.

Для дій над рядками вкажіть поле входу через `key: "id"`. ARC виводить тип ключа з контракту. Поле має бути обов’язковим і містити рядок або число. Для обчислюваного ключа передайте функцію. Тоді `cancelOrder.pending(order.id)` показує, чи триває виклик для цього рядка, включно з оновленням запитів із `refresh`. Повторний `run` із тим самим ключем повертає той самий Promise, а інші ключі можуть виконуватися паралельно.

`cancelOrder.failed("ORDER_ALREADY_CANCELLED", order.id)` перевіряє бізнес-помилку конкретного рядка. `cancelOrder.outcome(order.id)` повертає його останній результат і помилку або `undefined` до завершення виклику. Новий запуск очищає попередній результат лише для свого ключа.

## Оновлення query з відповіді

Після успішної mutation є два способи привести query до актуального стану:

| Опція | Коли використовувати | Поведінка |
| --- | --- | --- |
| `refresh: query` | Серверна операція могла змінити склад або інші поля списку, а її відповідь не є повним списком | Позначає query застарілим і чекає повторного читання з сервера. У графі — `INVALIDATES`. |
| `update: query.replaceBy("id")` | Відповідь уже містить повний актуальний запис, який є в завантаженому списку | Замінює запис у поточному snapshot і кеші без запиту. У графі — `UPDATES`. |
| `update: query.insertBy("id")` | Відповідь містить повний новий запис, який належить кінцю списку | Додає запис до завантаженого списку й кешу або зберігає наявний рядок із тим самим ID. У графі — `UPDATES`. |
| `update: detail.replace()` | Відповідь є повним значенням detail query | Замінює весь detail snapshot і кеш без запиту. У графі — `UPDATES`. |

Якщо одна відповідь має синхронізувати кілька запитів, передайте масив `update`-стратегій. Усі цілі отримають ту саму типізовану відповідь в одному batch:

```ts
const updateOrder = orderClient.mutation(UpdateOrder, {
  update: [order.replace(), orders.replaceBy("id")],
});
```

Це підходить, коли одна й та сама операція має оновити detail і список. Для запитів із різними output contracts використовуйте окремі мутації або `refresh`.

`setFrom` із `@arc/framework/fullstack` записує в локальний або спільний стан значення з відповіді. Наприклад, `update: [users.insertBy("id"), setFrom(selectedUser, (user) => user.id)]` додає підтверджений профіль і вибирає його в одному batch. У графі обидві цілі отримують зв’язок `UPDATES`.

```ts
const cancelOrder = orderClient.mutation(CancelOrder, {
  key: "id",
  update: orders.replaceBy("id"),
});
```

Після успіху ARC замінює наявний рядок даними з відповіді. Ключ запиту фіксується під час запуску мутації, тому навіть після перемикання користувача оновлюється його початковий список або кеш. Запит списку, який уже виконується, застосує підтверджену зміну перед показом результату.

Якщо сервер повертає підтверджений запис у деталях бізнес-помилки, ту саму стратегію можна застосувати через `updateOnError`:

```ts
const cancelOrder = orderClient.mutation(CancelOrder, {
  key: "id",
  update: ordersData.replaceBy("id"),
  updateOnError: "ORDER_ALREADY_CANCELLED",
});
```

Опція приймає код або масив кодів із типізованими `details`, сумісними з виходом операції. ARC застосовує оновлення за початковим ключем запиту й зберігає бізнес-помилку для `failed(...)` та повідомлення у формі.

Для створення замовлення Workspace використовує `update: ordersData.insertBy("id")`. Якщо перше читання списку ще триває, ARC застосує вставку до його результату. Для активного ключа без завантажених даних і без поточного читання ARC запускає читання. Якщо відповідь містить лише частину запису або сервер визначає його позицію чи належність до вибірки, використовуйте `refresh`.

Якщо потрібне миттєве відображення відповіді, а потім остаточне узгодження з сервером, задайте обидві опції: `update` застосовується першою, `refresh` запускається після неї. У більшості випадків достатньо однієї.

Для detail-сторінки достатньо передати повну відповідь до query:

```tsx
function OrderDetail({ query }: PageContext<"id">) {
  const order = query(orderClient, GetOrder);
  const updateOrder = orderClient.mutation(UpdateOrder, {
    update: order.replace(),
  });

  return <form onSubmit={updateOrder}>{/* поля з name */}</form>;
}
```

`query(client, contract)` бере параметри зі сторінки, якщо вони повністю задають вхід контракту. Після успіху `replace()` одразу оновлює показане замовлення й відповідний кеш.

Для звичайної форми не потрібен окремий pending state: submit action уже має `running`. Його можна відобразити прямо в кнопці:

```tsx
<button type="submit" disabled={updateOrder().running}>
  {updateOrder().running ? "Зберігаємо…" : "Зберегти зміни"}
</button>
```

## HTTP-транспорт

Server `internalTransport(app)` обслуговує POST /_arc/call/:operation. Операція повинна явно мати `expose:{web:true}` на server. Browser descriptor не надає дозволу. Input/output/error details перевіряються сервером; client також перевіряє output. Internal exception не передає stack чи raw message. AbortSignal передається fetch і request executor настільки, наскільки дозволяє HTTP disconnect.

Internal transport не замінює public REST routes. Application authorization залишається відповідальністю operation/request capabilities; exposure — дозвіл виклику, не authentication. Same-origin credentials та Origin check — MVP transport policy, не готова production identity система.

Практика у frontend Workspace: [feature guide](../web/writing-frontend.md), [forms та error UI](../web/forms-and-events.md), [Workspace](../workspace-app.md). HTTP status використовується transport; typed business Result не гарантує окремого status поля.
