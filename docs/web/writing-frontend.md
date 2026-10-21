# Як писати frontend на ARC

Цей посібник показує підхід кореневого [ARC Workspace](../workspace-app.md), а не новий паралельний frontend framework. Код application лежить у `src/`, framework implementation — у `framework/`.

## 1. Оберіть власника даних

| Потреба                                     | Primitive            | Приклад Workspace                                     |
| ------------------------------------------- | -------------------- | ----------------------------------------------------- |
| Поле форми, search, вибраний користувач     | state                | users.new-name, users.search, workspace.selected-user |
| Фільтр, сума, знайдений активний користувач | derive               | users.filtered, orders.total, users.active            |
| Дані із server/external API                 | remote / webResource | users.current, orders.current                         |
| Mutation або user command                   | action               | users.add, orders.add                                 |
| DOM та listeners                            | view / binding       | users.page, orders.table.rows                         |

Не зберігайте копію remote list у додатковому state без окремої потреби. Не запускайте fetch із derive.compute чи view.setup: load належить resource, mutation — action.

## 2. Розміщуйте код за feature

```text
src/
  users/
    contracts.ts   # browser-safe schemas і operation descriptors
    index.ts       # server repository, operation, module, REST
    page.ts        # browser state, resource, action, view
  orders/
    contracts.ts
    index.ts
    page.ts
  app.ts           # один logical application graph
  browser.ts       # browser runtime та mounts
  page.ts          # Workspace shell
  styles.ts        # application CSS
  ui.ts            # невеликі helpers для bindings/errors/escaping
```

Це структура прикладу, а не compiler convention. Runtime визначає node kind/metadata, не ім’я директорії. Shared contracts не повинні імпортувати server repositories чи secrets.

## 3. Використовуйте спільний contract

[users/contracts.ts](../../src/users/contracts.ts) експортує User, ListUsers та CreateUser. Server [users/index.ts](../../src/users/index.ts) створює `operation({...CreateUser, needs, run})`; browser імпортує тільки descriptor. Не дублюйте URL, DTO чи business error enum.

```ts
import { remote, remoteClient } from "@arc/framework/fullstack";
import { ListUsers, CreateUser } from "./contracts.ts";

const usersData = remote(ListUsers, { id: "users.current" });
const create = remoteClient(CreateUser, { id: "users.create.remote" });
```

Server descriptor має `expose: { web: true }`. Реєстрація browser remote сама не відкриває server operation. Публічний REST route для internal transport не потрібний.

## 4. Оголошуйте state, derived values та action

```ts
import { state, derive, action } from "@arc/framework/web";

const name = state({ id: "users.new-name", initial: "" });
const email = state({ id: "users.new-email", initial: "" });
const search = state({ id: "users.search", initial: "" });
const filtered = derive({
  id: "users.filtered",
  from: [usersData.data, search],
  compute: (users, query) =>
    (users ?? []).filter((user) =>
      `${user.name} ${user.email}`.toLowerCase().includes(query.toLowerCase()),
    ),
});
const add = action({
  id: "users.add",
  needs: { name, email, create },
  invalidates: [usersData],
  async run(_, ctx) {
    const result = await create.call(
      {
        name: name.get().trim(),
        email: email.get().trim(),
      },
      ctx,
    );
    if (result.ok) {
      ctx.set(name, "");
      ctx.set(email, "");
    }
    return result;
  },
});
```

Це скорочений варіант реального feature; у Workspace action також змінює selectedUser. `needs` описує graph dependencies: compiler не читає JS closures. `invalidates` додає graph relation і reload після success; business error не очищує поля й не запускає success invalidation. `ctx` передає signal та trace через remote boundary; `ctx.set` пов’язує state update із interaction trace.

Для synchronous пов’язаних writes використовуйте batch. Після await кілька ctx.set можуть бути згруповані explicit batch, якщо потрібна одна transaction; глобальна transaction не тримається відкритою під час network.

## 5. Створіть bindings і view

[Views](views.md) описує всі binding types; [форми](forms-and-events.md) — двосторонні input та submit. View збирає DOM один раз, `bind(binding, element)` підключає reactive updates. Bindings повинні бути оголошені у view.bindings.

Для application state не створюйте новий state на кожний callback/render. Один node object є одним instance. Для незалежних copies feature створюйте factory з унікальними IDs і явним ownership.

## 6. Підключіть logical graph і browser runtime

У [app.ts](../../src/app.ts) server composition містить:

```ts
web: { nodes: [WorkspacePage], entry: "src/browser.ts" }
```

WorkspacePage.needs посилається на UsersPage та OrdersPage, тому compiler знаходить їх транзитивно. У [browser.ts](../../src/browser.ts):

```ts
const app = webApplication({ nodes: [WorkspacePage], telemetry });
app.compile();
app.start();
app.mount(WorkspacePage, document.querySelector("#app")!);
app.mount(UsersPage, document.querySelector("#users")!);
app.mount(OrdersPage, document.querySelector("#orders")!);
```

Parent view створює mount targets перед child mounts. needs — architecture dependency, він не робить автоматичного DOM mount. Runtime починає application resources на start; pagehide викликає app.dispose та telemetry.dispose. Повний bootstrap і CSS injection — у browser.ts.

## 7. Перевірте boundary та interaction

`npm run graph` показує browser state/action/resource/view, server operation/resource і shared contracts. Stand :3100 має All/Frontend/Backend/Boundaries та interaction traces. `npm run build:app` перевіряє browser reachability; repositories й Node adapters не повинні опинитися в manifest inputs. [Тести](testing.md) перевіряють реальні user flows.
