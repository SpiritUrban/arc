# ARC Workspace — fullstack-приклад

ARC Workspace — приклад застосунку з користувачами та замовленнями в `examples/workspace/`. Він використовує server operations/resources, Web state/derive/action/view/bindings і fullstack remote bridge.

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

Початковий користувач — Demo User. Repositories in-memory: перезапуск server скидає зміни. Вибір користувача — демонстраційна авторизація Bearer UUID, яку вже використовував backend; login/password та production identity не реалізовані.

## Структура та graph

- `examples/workspace/app.ts` — composition users/orders, health route, Workspace web entry, createApp factory.
- `examples/workspace/users/contracts.ts`, `examples/workspace/orders/contracts.ts` — shared schema/operation descriptors. Input/output/error source один для server і browser.
- `examples/workspace/users/server.ts`, `examples/workspace/orders/server.ts` — існуючі серверні сховища, операції та REST-маршрути.
- `examples/workspace/auth.ts` — визначення користувача в межах HTTP-запиту.
- `examples/workspace/user-selection.ts` — спільний браузерний стан вибору та дані користувача.
- `examples/workspace/users/page.tsx` — users resource, search/local fields, create action, active user, bindings/view.
- `examples/workspace/orders/page.tsx` — віддалений список замовлень, форма на `remoteForm` і підсумки, залежні від вибраного користувача.
- `examples/workspace/page.tsx`, `examples/workspace/styles.ts` — responsive Workspace shell та стилі.
- `examples/workspace/browser.ts` — browser composition, mount, telemetry та pagehide disposal.
- `examples/workspace/ui.ts` — допоміжні функції для input bindings, форматування сум і повідомлень про помилки.

```text
users.create.submit.fields.name / users.create.submit.fields.email
  → users.create.submit [action]
    → users.create.submit.remote → users.create [server] → users.repository
    INVALIDATES → users.current → users.list [server]
workspace.selected-user
  → orders.list.query → orders.list [server] → auth.currentUser / orders.repository
orders.create.submit.fields.product / orders.create.submit.fields.quantity
  → orders.create.submit → orders.create.submit.remote → orders.create [server]
    INVALIDATES → orders.list.query
orders.list.query → orders.visible → DOM bindings підсумку
```

Remote order requests використовують request-scoped Authorization header з поточним selected user. При зміні identity resource abort попередній запит; framework generation guard відкидає старий результат. Додатковий derived filter не показує попереднього користувача під час reload.

ARC створює вузли прив’язок із TSX до mount. Bindings оновлюють поля вводу, підсумки, повідомлення та списки. `each` зберігає незмінні рядки таблиці замовлень за ID, а `bind:children` будує список користувачів із TSX; введені дані стають текстовими вузлами. Native form validation доповнюється server contract validation.

Browser bundle містить shared contracts та UI, але не repositories, Node crypto чи request auth implementation. Compile перевіряє remote exposure і contract compatibility. REST `/users`, `/orders`, `/health` збережені; `/` тепер application UI. Browser telemetry й server traces видно в одному Stand graph.

## Перевірка

`tests/workspace.test.ts` збирає browser bundle Workspace та виконує його в isolated VM/Linkedom із real HTTP transport. Перевіряє створення користувача й замовлення, суму, duplicate email, escaping, пошук, identity switching, trace continuity, disposal та відсутність server implementation у browser manifest. Це integration coverage, не візуальна перевірка в реальному браузері.

## Як змінювати frontend

Почніть із [покрокового frontend guide](web/writing-frontend.md). [Forms/events](web/forms-and-events.md) пояснює `bind:value`, `on:submit` і TSX-списки. [Lifecycle](web/lifecycle.md) описує mount панелей та ownership; [тести](web/testing.md) — перевірку feature без зовнішніх систем.

Для нового браузерного виклику оголосіть спільний контракт із `expose.web` і підключіть його на сервері. У формі опишіть поле в `remoteForm` і прив’яжіть його через `bind:value={fields.name}`. Додайте потрібний список у `refresh`, щоб ARC оновив його після успішного запиту.

Стилі належать application examples/workspace/styles.ts, а не framework. Shell навігація — anchor links до секцій, не SPA router. Форми використовують браузерні перевірки та серверні схеми, а `remoteForm` керує надсиланням і оновленням ресурсів.
