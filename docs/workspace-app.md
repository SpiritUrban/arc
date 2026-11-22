# ARC Workspace — fullstack-приклад

ARC Workspace — приклад застосунку для роботи з користувачами та замовленнями. Він показує, як доменні операції поєднують спільні контракти, серверну логіку, репозиторій і frontend. Після створення чи редагування користувача ARC оновлює список; для замовлення редагування оновлює detail query.

## Запуск

```sh
npm install
npm run dev:workspace
```

Application і internal transport: http://localhost:3000; Stand: http://localhost:3100. Якщо порти зайняті: `PORT=4323 STAND_PORT=4324 npm run dev:workspace`.

```sh
npm run build        # framework ESM, application ESM і .arc/web browser assets
npm run build:app    # лише browser assets Workspace
npm run graph       # єдиний server/browser/shared IR, без activation
npm test
```

`npm run dev:web-counter` і `npm run dev:fullstack-tasks` запускають окремі навчальні приклади Counter та Tasks. Dev CLI збирає bundle на старті, без автоматичного watch/HMR: після змін перезапустіть команду.

## Що можна зробити

1. Переглянути користувачів і знайти їх за ім’ям/email.
2. Створити користувача. Дублікат email показує business error; новий користувач автоматично стає активним.
3. Вибрати користувача зі списку.
4. Відредагувати ім’я чи email вибраного користувача. Зайнятий email повертає типізовану бізнес-помилку.
5. Створити для нього замовлення з назвою товару й кількістю 1–100. Ціна демонстраційна: 25 ₴ за одиницю.
6. Переглянути історію, кількість і суму замовлень; відфільтрувати історію за назвою товару. Підсумки рахують усі замовлення, незалежно від пошуку. Перемикання користувача завантажує його замовлення; попередня projection приховується одразу.
7. Скасувати замовлення з історії або сторінки деталей. Сервер перевіряє власника й поточний статус; після успіху detail і список показують «Скасовано».
8. Відкрити деталі замовлення, змінити товар або кількість і зберегти. Під час збереження кнопка показує стан дії; detail query одразу приймає відповідь `UpdateOrder`. Скасоване замовлення редагувати не можна.

Початковий користувач — Demo User. Repositories in-memory: перезапуск server скидає зміни. Вибір користувача — демонстраційна авторизація Bearer UUID, яку вже використовував backend; login/password та production identity не реалізовані.

## Структура та graph

- `examples/workspace/app.ts` — composition users/orders, health route, Workspace web entry, createApp factory.
- `examples/workspace/users/contracts.ts`, `examples/workspace/orders/contracts.ts` — shared schema/operation descriptors. `UserProfile` є єдиним визначенням полів профілю для відповіді, створення й редагування; input/output/error source один для server і browser.
- `examples/workspace/users/server.ts`, `examples/workspace/orders/server.ts` — існуючі серверні сховища, операції та REST-маршрути.
- `examples/workspace/auth.ts` — визначення користувача в межах HTTP-запиту.
- `examples/workspace/user-selection.ts` — спільний браузерний стан вибору та дані користувача.
- `examples/workspace/users/page.tsx` — пошук, вибір, створення та редагування користувачів через `mutation`.
- `examples/workspace/orders/page.tsx` — список замовлень через `query`, форма через `mutation` і підсумки для вибраного користувача.
- `examples/workspace/pages/layout.tsx` і `styles.ts` — спільна оболонка, меню та стилі. `pages/index.tsx` описує вміст огляду.
- `examples/workspace/pages/orders/[id].tsx` читає `GetOrder` за параметром маршруту й редагує замовлення через `UpdateOrder`.
- `app.ts` підключає `web: "./pages"`. Файли каталогу задають огляд на `/`, список на `/orders` і деталі на `/orders/:id`. За прямим посиланням операція `GetOrder` показує замовлення лише вибраному власнику.
- `examples/workspace/ui.ts` — допоміжні функції для input bindings, форматування сум і повідомлень про помилки.

```text
Форма створення користувача (onSubmit)
  → users.create.submit [action]
    → users.create.submit.remote → users.create [server] → users.repository
    INVALIDATES → users.list.query → users.list [server]
workspace.selected-user
  → orders.list.query → orders.list [server] → auth.currentUser / orders.repository
orders.create.submit.fields.product / orders.create.submit.fields.quantity
  → orders.create.submit → orders.create.submit.remote → orders.create [server]
    INVALIDATES → orders.list.query
users.update.submit → users.update.submit.remote → users.update [server]
  UPDATES → users.list.query
page:orders/[id] → orders.update.submit → orders.update.submit.remote → orders.update [server]
  UPDATES → orders.get.query + orders.list.query
page:orders/[id] → orders.detail-cancel.submit → orders.detail-cancel.submit.remote → orders.cancel [server]
  UPDATES → orders.get.query + orders.list.query
orders.list.query → orders.visible → DOM bindings підсумку
```

Запити замовлень використовують заголовок `Authorization` поточного користувача. `query` бере ID користувача як ключ. Після перемикання запит відкидає запізнілі відповіді попереднього ключа. При поверненні до вже відкритого користувача ARC показує його кешований список і оновлює його у фоні.

ARC створює вузли прив’язок із TSX до монтування. `each` у таблиці замовлень і JSX-список із `map` та `key` на сторінці користувачів зберігають DOM незмінених рядків. Браузерні перевірки форми доповнює перевірка за контрактом операції.

Browser bundle містить shared contracts та UI, але не repositories, Node crypto чи request auth implementation. Compile перевіряє remote exposure і contract compatibility. REST `/users`, `/orders`, `/health` збережені; `/` тепер application UI. Browser telemetry й server traces видно в одному Stand graph.

## Перевірка

`tests/workspace.test.ts` збирає browser bundle Workspace та виконує його в isolated VM/Linkedom із real HTTP transport. Перевіряє створення користувача й замовлення, суму, duplicate email, escaping, пошук, identity switching, trace continuity, disposal та відсутність server implementation у browser manifest. Це integration coverage, не візуальна перевірка в реальному браузері.

## Як змінювати frontend

Почніть із покрокового посібника про frontend. [Як писати frontend](web/writing-frontend.md) · [Форми й події](web/forms-and-events.md) · [Життєвий цикл](web/lifecycle.md) · [Тести](web/testing.md)

Для нової операції оголосіть спільний контракт із `expose: { web: true }` і реалізуйте його на сервері. Для читання використайте `query`. Для запису прив’яжіть `mutation` до `onSubmit` та вкажіть запити для оновлення в `refresh`. Полям, потрібним лише під час надсилання, достатньо HTML-атрибута `name`.

Для форми редагування на detail-сторінці передайте `update: order.replace()` у `mutation`: успішна відповідь замінить поточні дані запиту без додаткового GET. Якщо форма міститься в умовній JSX-гілці, action усе одно залишається в графі до завантаження даних.

Стилі застосунку лежать у `examples/workspace/styles.ts`. Навігація Workspace використовує посилання на секції сторінки.
