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

`users()` повертає поточний знімок із `data`, `loading`, `error` та `stale`. Пряме читання в реактивному JSX додає запит до графа сторінки. Для читання, прихованого всередині допоміжної функції, запит можна додати через `needs`. `mutation` приймає цей самий запит у `refresh`. За замовчуванням ID має вигляд `<ID операції>.query`. Для фіксованого входу передайте `params`, наприклад `query(GetOrder, { params: { id } })`. Якщо вхід залежить від реактивних джерел, передайте функцію `input`. Наприклад, у `query(GetOrder, { from: selectedId, input: (id) => ({ id }) })` TypeScript виводить тип `id` із сигналу `selectedId`. Для масиву джерел функція отримує їхні значення в тому самому порядку.

У звичайному `query()` достатньо `cache: true`: ARC будує ключ із усіх значень `from` і зберігає останній успішний результат для кожного ключа. Для такого ключа джерела мають містити примітиви або JSON-подібні дані. Функція `key` перевизначає автоматичний ключ і отримує ті самі значення джерел, що й `input`. Щоб розділяти дані за ключем без кешування, передайте `key: true`.

Якщо один сигнал уже містить повний вхід контракту, передайте `query(GetOrder, { from: orderParams, input: true })`. ARC читає актуальне значення сигналу під час кожного запиту. Якщо значення сигналу потрібно покласти в одне поле, використовуйте `query(GetOrder, { from: selectedId, input: "id" })`, коли об’єкт із цим полем задовольняє контракт.

Якщо кілька елементів використовують однакове похідне значення, оголосіть його через `query.select(name, compute)`. Функція отримує `undefined`, коли даних для поточного ключа ще немає. ARC додає похідному значенню ID `<ID запиту>.select.<name>` і звільняє його разом із запитом. Для підстановки значення за замовчуванням достатньо `query.dataOr(fallback, name?)`. У Workspace `ordersData.dataOr([], "visible")` дає спільний список для таблиці й підсумку, а `users.dataOr([], "profiles")` — для пошуку й лічильника користувачів. ARC використовує порожній масив, коли дані дорівнюють `undefined`.

Через `query.select(name, from, compute)` можна додати один сигнал або список реактивних джерел. Функція отримує дані запиту, а потім значення джерел у заданому порядку. Наприклад, `users.select(selectedUser, (rows, id) => rows?.find((user) => user.id === id))` переобчислює активний профіль при зміні списку або вибору. Зміна джерела вибірки сама по собі не запускає запит. Якщо окрема назва в графі не потрібна, використовуйте `query.select(compute)` або `query.select(from, compute)`. ARC призначить вільний числовий суфікс у межах запиту.

Для списку з обов’язковим рядковим або числовим `id` можна використати `users.findById(selectedUser)`, як у Workspace. Метод приймає ID або сигнал із ним і повертає реактивне значення. Якщо даних ще немає або поточний результат не містить цього рядка, значення дорівнює `undefined`.

У файлах застосунку, що проходять через ARC CLI або browser build, reactive JSX вмикається автоматично. Pragma потрібен лише для окремої TSX-точки входу поза графом застосунку.

Для повторного читання можна передати `onClick={users.refresh}`. Пряма прив’язка додає запит до графа сторінки, навіть якщо шаблон лише запускає його з кнопки. ARC продовжує трасу браузерної події в Stand.

У TSX, який збирає ARC, проста обгортка `onClick={() => users.refresh()}` теж додає зв’язок із запитом у графі.

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

Під час submit ARC читає значення через `FormData`, обрізає зовнішні пробіли й перетворює поля `number` та `integer` за схемою операції. Доступний checkbox для boolean-поля передає `true` або `false`. Вимкнені поля, зокрема поля у вимкненому `fieldset`, пропускаються. Для array-полів повторені значення стають масивом, а числові й булеві елементи перетворюються за схемою елемента. Невибрана checkbox-група дає `[]`. Порожній рядок у числовому полі не стає нулем. Перед запитом ARC перевіряє весь вхід за контрактом. `refresh` приймає один ресурс напряму або масив ресурсів. `addTask()` повертає знімок дії з `running`, `result` і `error`.

Якщо значення потрібне в інтерфейсі до submit, додайте `bind:value` до іменованого поля. Після успіху ARC скидає незмінене поле й прив’язаний стан до початкового значення. Для власного перетворення даних можна явно задати `fields`.

Порожні необов’язкові числові поля, email, UUID і текстові поля з мінімальною довжиною пропускаються. Якщо текстовий контракт допускає порожній рядок, ARC передає його як значення. Обов’язкові поля й некоректні числа проходять звичайну перевірку контракту.

Для форм редагування можна задати `resetOnSuccess: false`. ARC зберігає введені значення після успіху, а `update` та `onSuccess` далі можуть застосувати підтверджені дані. У формах створення скидання діє за замовчуванням.

Якщо частина входу вже є в контексті форми, передайте її через `mutation.with(params)`. Для одного поля можна передати назву й значення окремо. Наприклад, `onSubmit={updateUser.with("id", user.id)}` бере ID з профілю, а ім’я та email читає з іменованих полів. Для кількох полів передайте об’єкт. Параметри фіксуються під час створення прив’язки, мають пріоритет над полями й параметрами мутації та проходять перевірку разом з усім входом. Прив’язка використовує стан тієї самої мутації.

Кнопка надсилання з атрибутом `name` додає своє `value` до контрактного входу. Наприклад, дві кнопки з `name="mode"` і різними значеннями передають режим натиснутої кнопки. Це працює і з прямою мутацією в `onSubmit`, і з `mutation.with(params)`.

`mutation.failed(code)` перевіряє конкретну бізнес-помилку. TypeScript приймає лише коди з контракту. Наприклад, у реактивному JSX `aria-invalid={addUser.failed("EMAIL_EXISTS")}` позначає поле email після відмови сервера. Перевірка скидається при наступному надсиланні.

`mutation.invalid(field)` перевіряє, чи не пройшло поле вхідну валідацію перед запитом. Ім’я поля TypeScript бере зі схеми входу. Наприклад, `aria-invalid={createOrder.invalid("quantity")}` позначає кількість, а JSX поруч із полем може показати власне повідомлення. `mutation.invalid()` повертає `true`, якщо контрактну перевірку не пройшло хоча б одне поле; ним зручно приховати загальне повідомлення про помилку, коли помилки вже показані біля полів. Щоб браузер передав надсилання ARC навіть із невалідним значенням, додайте до форми `novalidate`.

Якщо стан поля потрібен у кількох прив’язках, оголосіть `const quantityInvalid = createOrder.invalidField("quantity")`. Передайте його напряму в `aria-invalid={quantityInvalid}`, а для повідомлення читайте `quantityInvalid()`. ARC повертає те саме реактивне значення для поля й звільняє його разом із мутацією.

`mutation.field(name)` також готує атрибути для іменованого `<input>`. Атрибути містять ім’я, `aria-invalid` і відповідні обмеження з контракту для тексту, email та чисел. Для числового літерала ARC задає однакові `min` і `max`. Валідація ARC перевіряє весь вхід під час надсилання. Атрибути інтерфейсу, як-от підказку або `bind:value`, додайте поруч. Кілька полів можна отримати одним викликом, як у Workspace: `const { product, quantity } = createOrder.fieldsFor("product", "quantity")`. TypeScript перевіряє кожну назву за контрактом.

Для булевого поля `<input {...savePreferences.field("enabled").input} />` створює checkbox. Невстановлений прапорець передає `false`. Якщо обов’язкове поле має схему `s.literal(true)`, ARC також додає HTML-атрибут `required`. Для `s.literal(true).optional()` незазначений прапорець пропускається. Для власного `select` або радіогрупи використовуйте значення `"true"` і `"false"`. Для двосторонньої прив’язки прапорця до сигналу використовуйте `bind:checked`.

Щоб пов’язати бізнес-помилку з полем, оголосіть її в контракті як `EMAIL_EXISTS: { status: 409, field: "email" }`, як у Workspace. Якщо конкретній формі потрібен інший код для цього поля, задайте `fieldErrors` в опціях мутації. ARC позначить `field("email").invalid()` та його `aria-invalid` при контрактній помилці поля або при відповіді з цим кодом. Ім’я поля й код перевіряються за контрактом. Збережіть `const email = saveUser.field("email")` і читайте `email.failed()`, щоб визначити, чи сталася прив’язана бізнес-помилка. Для виведення тексту використовуйте `email.errorMessage({ invalid: "Перевірте адресу email.", failed: "Ця адреса вже зайнята." })`. ARC вибирає повідомлення за поточним станом поля й повертає `undefined`, якщо для цього стану тексту немає. Якщо для всіх помилок поля підходить один текст, передайте рядок, як у формі замовлення Workspace: `product.errorMessage("Вкажіть назву товару.")`.

```tsx
const quantity = createOrder.field("quantity");
<input {...quantity.input} />
{quantity.invalid() && <p role="alert">Перевірте кількість.</p>}
```

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
  update: [order, ordersData.replaceBy()],
}));

return (
  <form onSubmit={updateOrder}>
    <input name="product" />
    <input name="quantity" type="number" />
    <button type="submit">Зберегти</button>
  </form>
);
```

ARC об’єднує іменовані поля з `params` і перевіряє спільний вхід за контрактом. Якщо одне ім’я присутнє в обох джерелах, пріоритет має `params`. Прямий виклик `mutation.run(input)` приймає повний вхід. Поки виконується submit, ARC автоматично вимикає кнопки надсилання й оновлює `aria-busy` на формі. Явно заданий `aria-busy` має пріоритет.

## Спільний клієнт для читання та запису

Для статичних налаштувань достатньо, наприклад, `remoteApi({ headers: { "x-api-version": "2" } })`. Клієнт використовує ці заголовки в запитах і мутаціях. Реактивне джерело `from` потрібне, коли контекст запитів залежить від сигналів. Для Bearer-токена передайте рядок у `bearer` або функцію, яка читає значення `from`. Якщо сигнал із токеном є єдиним джерелом клієнта, передайте його напряму через `bearer`, як у Workspace. ARC використовує цей сигнал і для ключа запиту. За явного `from` із одним сигналом також можна задати `bearer: true`. Для `undefined` або порожнього рядка ARC пропускає заголовок. Явний `Authorization` має пріоритет.

```ts
const orderClient = remoteApi({
  bearer: selectedUser,
  key: true,
});
const orders = orderClient.query(ListOrders, {
  cache: true,
});
const createOrder = orderClient.mutation(CreateOrder, {
  refresh: orders,
});
```

У Workspace зміна джерела в `from` оновлює запити читання, а форма використовує актуальне значення для наступного надсилання. `query` виводить ID як `<ID операції>.query`. Для контракту з обов’язковим входом передайте функцію `input`. [Форма замовлень](../../examples/workspace/orders/page.tsx)

Якщо єдиний сигнал клієнта вже містить повний вхід контракту, використовуйте `client.query(GetOrder, { input: true })`. У клієнті, прив’язаному через `bind(client)`, ці режими також будують вхід цілком із сигналу. Наприклад, із сигналом ID використовуйте `client.query(GetOrder, { input: "id" })`. Коли решта обов’язкових полів надходить із маршруту, `bind(client).query(FindOrder, { input: "locale" })` може взяти `locale` із сигналу клієнта, а `id` із маршруту. Для довільного поєднання даних передайте функцію `input`.

`key: true` будує ключ із усіх значень `from`. Його можна задати для всього клієнта або для окремого запиту, зокрема без кешу. Так Workspace одразу приховує деталі попереднього власника, коли змінюється вибір. `cache: true` також вмикає автоматичний ключ, якщо клієнт і запит залишили `key` порожнім. Для нестандартного ключа передайте функцію. Опція запиту має пріоритет над опцією клієнта.

Автоматичний ключ працює з примітивами й JSON-подібними даними. При зміні ключа ARC відкидає запізнілі відповіді попереднього ключа. Кеш показує останній успішний результат для нового ключа, якщо він є, і завантажує свіжі дані у фоні. Під час фонового запиту `loading` і `stale` мають значення `true`. Кеш тримає до 32 ключів у пам’яті та очищається разом із запитом.

## Дія без форми

```tsx
const cancelOrder = orderClient.mutation(CancelOrder, { refresh: orders });

<button type="button" onClick={() => cancelOrder.run({ id: order.id })}>
  Скасувати
</button>
```

`run(input)` приймає вхід із контракту й перевіряє його перед запитом. Стан дії, бізнес-помилки, `onSuccess` і `refresh` працюють так само, як у формі. Прямий виклик із `onClick` продовжує трасу кліку у Stand.

У TSX, який збирає ARC, `onClick={() => cancelOrder.run({ id })}` додає мутацію до графа сторінки. Те саме працює для простого виклику `onClick={() => cancel.run()}`, якщо `cancel` отримано через `cancelOrder.for(...)`.

Для дій над рядками вкажіть поле входу через `key: "id"`. ARC виводить тип ключа з контракту. Поле має бути обов’язковим і містити рядок або число. Для обчислюваного ключа передайте функцію. Тоді `cancelOrder.pending(order.id)` показує, чи триває виклик для цього рядка, включно з оновленням запитів із `refresh`. Повторний `run` із тим самим ключем повертає той самий Promise, а інші ключі можуть виконуватися паралельно.

`cancelOrder.failed("ORDER_ALREADY_CANCELLED", order.id)` перевіряє бізнес-помилку конкретного рядка. `cancelOrder.outcome(order.id)` повертає його останній результат і помилку або `undefined` до завершення виклику. Новий запуск очищає попередній результат лише для свого ключа.

Для кнопки, яка запускає дію й читає її стан, прив’яжіть вхід один раз через `const cancel = cancelOrder.for({ id: order.id })`. Передайте `onClick={cancel.run}` і читайте `cancel.pending()`, `cancel.outcome()` або `cancel.failed(code)` без повторного передавання ID. Пряма прив’язка додає в граф зв’язок `TRIGGERS` від кнопки до мутації. `for` працює з мутаціями, для яких задано `key`. Усі прив’язки з однаковим ключем використовують спільний стан мутації. У Workspace `<button type="button" {...cancel.buttonProps}>` підключає `onClick` і оновлює `disabled` та `aria-busy`, поки триває дія для цього рядка. Якщо поле `key` — єдине обов’язкове поле контракту, можна передати його значення напряму, як у Workspace: `cancelOrder.for(order.id)`.

## Оновлення query з відповіді

Після успішної mutation є два способи привести query до актуального стану:

| Опція | Коли використовувати | Поведінка |
| --- | --- | --- |
| `refresh: query` | Серверна операція могла змінити склад або інші поля списку, а її відповідь не є повним списком | Позначає query застарілим і чекає повторного читання з сервера. У графі — `INVALIDATES`. |
| `update: query.replaceBy()` | Відповідь уже містить повний актуальний запис, який є в завантаженому списку | Замінює запис у поточному snapshot і кеші без запиту. У графі — `UPDATES`. |
| `update: query.insertBy()` | Відповідь містить повний новий запис, який належить кінцю списку | Додає запис до завантаженого списку й кешу або зберігає наявний рядок із тим самим ID. У графі — `UPDATES`. |
| `update: detail.replace()` | Відповідь є повним значенням detail query | Замінює весь detail snapshot і кеш без запиту. У графі — `UPDATES`. |

Передайте сам запит у `update`, коли відповідь мутації має стати його повним значенням. Явний виклик `order.replace()` теж працює.

Без аргументу `insertBy()` і `replaceBy()` використовують обов’язкове поле `id` типу `string` або `number`. Для іншого ключа передайте назву поля, наприклад `orders.replaceBy("number")`.

Якщо одна відповідь має синхронізувати кілька запитів, передайте масив `update`-стратегій. Усі цілі отримають ту саму типізовану відповідь в одному batch:

```ts
const updateOrder = orderClient.mutation(UpdateOrder, {
  update: [order, orders.replaceBy()],
});
```

Це підходить, коли одна й та сама операція має оновити detail і список. Для запитів із різними output contracts використовуйте окремі мутації або `refresh`.

`setFrom` із `@arc/framework/fullstack` записує в локальний або спільний стан значення з відповіді. Наприклад, `update: [users.insertBy(), setFrom(selectedUser, "id")]` додає підтверджений профіль і вибирає його в одному batch. У графі обидві цілі отримують зв’язок `UPDATES`. Значення вибраного поля має бути сумісним із типом стану. Для обчислюваного значення передайте функцію.

```ts
const cancelOrder = orderClient.mutation(CancelOrder, {
  key: "id",
  update: orders.replaceBy(),
});
```

Після успіху ARC замінює наявний рядок даними з відповіді. Ключ запиту фіксується під час запуску мутації, тому навіть після перемикання користувача оновлюється його початковий список або кеш. Запит списку, який уже виконується, застосує підтверджену зміну перед показом результату.

Якщо деталі бізнес-помилки містять актуальний запис того самого типу, що й успішна відповідь, оголосіть це в контракті. У Workspace `ORDER_ALREADY_CANCELLED: { status: 409, details: Order, updateFromDetails: true }` дозволяє застосувати `update` і в списку, і на сторінці деталей. Мутація зберігає результат бізнес-помилки, тому інтерфейс може показати відповідне повідомлення. Опція `updateOnError` перевизначає перелік кодів для окремої мутації.

```ts
const cancelOrder = orderClient.mutation(CancelOrder, {
  key: "id",
  update: ordersData.replaceBy(),
});
```

`updateOnError` приймає код або масив кодів із типізованими `details`, сумісними з виходом операції. ARC застосовує оновлення за початковим ключем запиту й зберігає бізнес-помилку для `failed(...)` та повідомлення у формі.

Для створення замовлення Workspace використовує `update: ordersData.insertBy()`. Якщо перше читання списку ще триває, ARC застосує вставку до його результату. Для активного ключа без завантажених даних і без поточного читання ARC запускає читання. Якщо відповідь містить лише частину запису або сервер визначає його позицію чи належність до вибірки, використовуйте `refresh`.

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
