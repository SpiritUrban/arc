# Як писати frontend на ARC

Почніть із доменної операції, яку виконує сторінка. У Workspace форма створює користувача через контракт `CreateUser`, а список читає користувачів через `ListUsers`. [ARC Workspace](../workspace-app.md)

## 1. Оберіть власника даних

| Потреба | API | Приклад Workspace |
| --- | --- | --- |
| Стан екземпляра сторінки | `view.state` | `search` |
| Спільний вибір | `signal` | `selectedUser` |
| Похідні дані | функція або `derive` | `visible()`, `visibleOrders` |
| Читання з сервера | `query` | `users`, `ordersData` |
| Запис на сервер | `mutation` | `addUser`, `createOrder` |

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
import { mutation } from "@arc/framework/fullstack";
import { CreateUser } from "./contracts.ts";
import { selectedUser, users } from "../user-selection.ts";

const addUser = mutation(CreateUser, {
  needs: [selectedUser],
  refresh: [users],
  onSuccess(user, ctx) {
    ctx.set(selectedUser, user.id);
  },
});
```

`refresh` оновлює список після успіху. `onSuccess` отримує типізовану відповідь і вибирає нового користувача. `needs` додає цей зв’язок до графа.

## 5. Оголосіть шаблон і прив’язки

```tsx
<form onSubmit={addUser}>
  <label>Ім’я <input name="name" required /></label>
  <label>Email <input name="email" required type="email" /></label>
  <button type="submit">Додати користувача</button>
</form>
```

ARC створює вузли директив ще до монтування. На сторінці замовлень `project` обчислює кількість і суму в JSX, а `visibleOrders` лишається спільним джерелом для підсумку й таблиці. [Посібник про шаблони](views.md)

## 6. Підключіть logical graph і browser runtime

У [app.ts](../../examples/workspace/app.ts) server composition містить:

```ts
web: "./page.tsx"
```

Файл `page.tsx` експортує кореневий `view` через `export default`. ARC додає сторінку до графа Stand і генерує браузерний запуск із телеметрією. Опційні експорти `title` і `styles` задають заголовок і CSS. На `pagehide` ARC звільняє застосунок, стилі й транспорт телеметрії. [Коренева сторінка](../../examples/workspace/page.tsx)

CLI визначає шлях до сторінки відносно файла застосунку. Для програмної компіляції передайте URL цього файла через `app.compile({ entry })`. Завантаження сторінки з TSX потребує TypeScript.

## 7. Перевірте boundary та interaction

`npm run graph` показує browser state/action/resource/view, server operation/resource і shared contracts. Stand :3100 має All/Frontend/Backend/Boundaries та interaction traces. `npm run build:app` перевіряє browser reachability; repositories й Node adapters не повинні опинитися в manifest inputs. [Тести](testing.md) перевіряють реальні user flows.
