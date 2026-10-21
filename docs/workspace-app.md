# ARC Workspace — кореневий проєкт

Це застосунок на ARC, який лежить у `src/`, окремо від реалізації фреймворку у `framework/`. Він використовує server operations/resources, Web state/derive/action/view/bindings і fullstack remote bridge. Приклади в `examples/` не замінюють цей проєкт.

## Запуск

```sh
npm install
npm run dev
```

Application і internal transport: http://localhost:3000; Stand: http://localhost:3100. Якщо порти зайняті: `PORT=4323 STAND_PORT=4324 npm run dev`.

```sh
npm run build        # framework ESM, application ESM і .arc/web browser assets
npm run build:app    # лише browser assets кореневого застосунку
npm run graph       # єдиний server/browser/shared IR, без activation
npm test
```

`npm run dev:web` і `dev:fullstack` запускають окремі навчальні приклади Counter та Tasks. Dev CLI збирає bundle на старті, без автоматичного watch/HMR: після змін перезапустіть команду.

## Що можна зробити

1. Переглянути користувачів і знайти їх за ім’ям/email.
2. Створити користувача. Дублікат email показує business error; новий користувач автоматично стає активним.
3. Вибрати користувача зі списку.
4. Створити для нього замовлення з назвою товару й кількістю 1–100. Ціна демонстраційна: 25 ₴ за одиницю.
5. Переглянути його історію, кількість замовлень і загальну суму. Перемикання користувача завантажує його замовлення; попередня projection приховується одразу.

Початковий користувач — Demo User. Repositories in-memory: перезапуск server скидає зміни. Вибір користувача — демонстраційна авторизація Bearer UUID, яку вже використовував backend; login/password та production identity не реалізовані.

## Структура та graph

- `src/app.ts` — composition users/orders, health route, Workspace web entry, createApp factory.
- `src/users/contracts.ts`, `src/orders/contracts.ts` — shared schema/operation descriptors. Input/output/error source один для server і browser.
- `src/users/index.ts`, `src/orders/index.ts` — існуючі server repositories, request auth capability, operations та REST routes.
- `src/users/page.ts` — users resource, search/local fields, create action, active user, bindings/view.
- `src/orders/page.ts` — user-dependent remote resource, create action, totals, table bindings/view.
- `src/page.ts`, `src/styles.ts` — responsive Workspace shell та стилі.
- `src/browser.ts` — browser composition, mount, telemetry та pagehide disposal.
- `src/ui.ts` — input binding helpers, escaping dynamic HTML і friendly error messages.

```text
users.new-name / users.new-email
  → users.add [action]
    → users.create.remote → users.create [server] → users.repository
    INVALIDATES → users.current → users.list [server]
workspace.selected-user
  → orders.current → orders.list [server] → auth.currentUser / orders.repository
orders.new-product / orders.new-quantity
  → orders.add → orders.create.remote → orders.create [server]
    INVALIDATES → orders.current
orders.current → orders.visible → orders.total → DOM bindings
```

Remote order requests використовують request-scoped Authorization header з поточним selected user. При зміні identity resource abort попередній запит; framework generation guard відкидає старий результат. Додатковий derived filter не показує попереднього користувача під час reload.

View setup виконується один раз на mount. Input, totals, loading/errors і list/table regions оновлюються bindings. Таблиця й список використовують escaped HTML у property binding; keyed row reconciliation ще немає. Довільний user text екранується перед вставкою. Native form validation доповнюється server contract validation.

Browser bundle містить shared contracts та UI, але не repositories, Node crypto чи request auth implementation. Compile перевіряє remote exposure і contract compatibility. REST `/users`, `/orders`, `/health` збережені; `/` тепер application UI. Browser telemetry й server traces видно в одному Stand graph.

## Перевірка

`tests/workspace.test.ts` збирає фактичний root browser bundle та виконує його в isolated VM/Linkedom із real HTTP transport. Перевіряє створення користувача й замовлення, суму, duplicate email, escaping, пошук, identity switching, trace continuity, disposal та відсутність server implementation у browser manifest. Це integration coverage, не візуальна перевірка в реальному браузері.
