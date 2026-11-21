# Як писати frontend на ARC

Цей посібник використовує [приклад ARC Workspace](../workspace-app.md) з `examples/workspace/`. Реалізація фреймворку лежить у `framework/`.

## 1. Оберіть власника даних

| Потреба                                     | Primitive            | Приклад Workspace                                     |
| ------------------------------------------- | -------------------- | ----------------------------------------------------- |
| Поле форми, search, вибраний користувач     | state                | users.create.submit.fields.name, users.search, workspace.selected-user |
| Фільтр, видимі замовлення, активний користувач | derive               | users.filtered, orders.visible, users.active            |
| Дані із server/external API                 | remote / webResource | users.current, orders.list.query                         |
| Mutation або user command                   | action               | users.create.submit, orders.create.submit                                 |
| DOM та listeners                            | view / binding       | users.page, `each(visibleOrders, …)`                         |

Не зберігайте копію remote list у додатковому state без окремої потреби. Не запускайте fetch із `derive.compute` чи `view.template`: load належить resource, mutation — action.

## 2. Розміщуйте код за feature

```text
examples/workspace/
  user-selection.ts # вибраний користувач і віддалений список
  users/
    contracts.ts   # browser-safe schemas і operation descriptors
    server.ts       # server repository, operation, module, REST
    page.tsx        # browser state, resource, action, view
  orders/
    contracts.ts
    server.ts
    page.tsx
  auth.ts          # серверний користувач поточного запиту
  app.ts           # один logical application graph
  browser.ts       # browser runtime та mounts
  page.tsx          # Workspace shell
  styles.ts        # application CSS
  ui.ts            # невеликі helpers для bindings і повідомлень про помилки
```

Це структура прикладу, а не compiler convention. Runtime визначає node kind/metadata, не ім’я директорії. Shared contracts не повинні імпортувати server repositories чи secrets.

## 3. Використовуйте спільний contract

[users/contracts.ts](../../examples/workspace/users/contracts.ts) експортує User, ListUsers та CreateUser. Server [users/server.ts](../../examples/workspace/users/server.ts) створює `operation(CreateUser, { needs, run })`; browser імпортує тільки descriptor. Не дублюйте URL, DTO чи business error enum.

Сервер відкриває браузерний виклик через `expose: { web: true }` у контракті. REST-маршрут можна оголосити окремо або створити разом з операцією через `http.post(path, contract, implementation)`, як у [замовленнях](../../examples/workspace/orders/server.ts).

## 4. Опишіть форму та її результат

```ts
import { remoteForm, textField } from "@arc/framework/fullstack";
import { CreateUser } from "./contracts.ts";
import { selectedUser, usersData } from "../user-selection.ts";

const { fields, submit: addUser } = remoteForm(CreateUser, {
  fields: { name: textField(), email: textField() },
  needs: [selectedUser],
  refresh: [usersData],
  onSuccess(user, ctx) {
    ctx.set(selectedUser, user.id);
  },
});
```

`remoteForm` створює стан полів, дію та endpoint у графі. `refresh` оновлює список після успіху. `onSuccess` отримує типізовану відповідь і змінює вибір користувача. `needs` показує цю залежність у Stand. Локальний пошук використовує окремий `state` і `derive` від завантажених користувачів.

## 5. Оголосіть шаблон і прив’язки

```tsx
<form on:submit={addUser}>
  <label>Ім’я <input required bind:value={fields.name} /></label>
  <label>Email <input required type="email" bind:value={fields.email} /></label>
  <button type="submit" bind:disabled={addUser.running}>Додати користувача</button>
</form>
```

ARC створює вузли директив ще до монтування. На сторінці замовлень `project` обчислює кількість і суму в JSX, а `visibleOrders` лишається спільним джерелом для підсумку й таблиці. [Посібник про шаблони](views.md)

## 6. Підключіть logical graph і browser runtime

У [app.ts](../../examples/workspace/app.ts) server composition містить:

```ts
web: { nodes: [WorkspacePage], entry: "examples/workspace/browser.ts" }
```

WorkspacePage.needs посилається на UsersPage та OrdersPage, тому compiler знаходить їх транзитивно. У [browser.ts](../../examples/workspace/browser.ts):

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
