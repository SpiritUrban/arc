# ARC Workspace — fullstack-приклад

ARC Workspace — приклад застосунку для роботи з користувачами та замовленнями. Він показує, як доменна операція «створити замовлення» поєднує спільний контракт, серверну логіку, репозиторій і форму. Після успіху ARC оновлює список замовлень поточного користувача.

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
4. Створити для нього замовлення з назвою товару й кількістю 1–100. Ціна демонстраційна: 25 ₴ за одиницю.
5. Переглянути його історію, кількість замовлень і загальну суму. Перемикання користувача завантажує його замовлення; попередня projection приховується одразу.
6. Скасувати своє замовлення кнопкою в історії. Сервер перевіряє власника й поточний статус, після успіху рядок лишається в історії зі статусом «Скасовано».

Початковий користувач — Demo User. Repositories in-memory: перезапуск server скидає зміни. Вибір користувача — демонстраційна авторизація Bearer UUID, яку вже використовував backend; login/password та production identity не реалізовані.

## Структура та graph

- `examples/workspace/app.ts` — composition users/orders, health route, Workspace web entry, createApp factory.
- `examples/workspace/users/contracts.ts`, `examples/workspace/orders/contracts.ts` — shared schema/operation descriptors. Input/output/error source один для server і browser.
- `examples/workspace/users/server.ts`, `examples/workspace/orders/server.ts` — існуючі серверні сховища, операції та REST-маршрути.
- `examples/workspace/auth.ts` — визначення користувача в межах HTTP-запиту.
- `examples/workspace/user-selection.ts` — спільний браузерний стан вибору та дані користувача.
- `examples/workspace/users/page.tsx` — пошук, список користувачів і форма створення через `mutation`.
- `examples/workspace/orders/page.tsx` — список замовлень через `query`, форма через `mutation` і підсумки для вибраного користувача.
- `examples/workspace/page.tsx`, `examples/workspace/styles.ts` — responsive Workspace shell та стилі.
- `examples/workspace/browser.ts` — browser composition, mount, telemetry та pagehide disposal.
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

Стилі застосунку лежать у `examples/workspace/styles.ts`. Навігація Workspace використовує посилання на секції сторінки.
