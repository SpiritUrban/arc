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

Для однієї сторінки достатньо шляху до її файла. [Fullstack Tasks](../../examples/fullstack-tasks/app.ts)

```ts
web: "./page.tsx"
```

Файл `page.tsx` може експортувати звичайну функцію через `export default`. ARC вмикає реактивний JSX для кореневого файла, додає сторінку до Stand під ID зі шляху файла й генерує браузерний запуск із телеметрією. Опційні експорти `title` і `styles` задають заголовок і CSS. [Проста сторінка Tasks](../../examples/fullstack-tasks/page.tsx)

Для локального стану функція отримує `local` через `PageContext`. Власний ID можна задати через явний `view`. На `pagehide` ARC звільняє застосунок, стилі й транспорт телеметрії. [Локальний стан](views.md#локальний-стан) · [Коренева сторінка Workspace](../../examples/workspace/pages/index.tsx)

CLI визначає шлях до сторінки відносно файла застосунку. Для програмної компіляції передайте URL цього файла через `app.compile({ entry })`. Завантаження сторінки з TSX потребує TypeScript.

Для маршрутизації за файлами задайте `web: "./pages"`. ARC бере шляхи з TSX-файлів у каталозі.

```text
pages/
  layout.tsx          # спільний макет
  index.tsx           # /
  orders/
    layout.tsx        # макет лише для /orders і дочірніх сторінок
    index.tsx         # /orders
    [id].tsx          # /orders/:id
```

`index.tsx` відповідає адресі каталогу, а квадратні дужки позначають параметр. Кореневий `layout.tsx` обгортає всі сторінки; вкладений макет обгортає сторінки лише у своєму розділі. Вкладені макети утворюють ланцюг від кореня до каталогу сторінки. Допоміжні компоненти зберігайте поруч із `pages`. Для адрес, які задаєте явно, доступний `web.pages`.

Кожна адреса відкривається напряму й через звичайне посилання. ARC генерує окремий браузерний вхід для кожної сторінки. У Workspace `/orders` також є REST-маршрутом. Запит із `Accept: text/html` відкриває сторінку, а запит JSON викликає серверну операцію.

Сторінка з параметрами маршруту отримує їх через `params` у `PageContext`. Якщо вони повністю задають вхід контракту, передайте `params` у `query(client, contract, options)`. Для складнішого відображення лишається `input`. ARC прив’язує запит до життєвого циклу сторінки; `own` лишається для інших ресурсів. [Деталі замовлення](../../examples/workspace/pages/orders/[id].tsx)

У каталозі сторінок ARC підключає кожен `layout.tsx` автоматично. У явній конфігурації шлях до кореневого макета задається через `layout` поруч із `pages`. Файл макета експортує функцію, яка отримує `children` для вкладеного вмісту сторінки та `route` для поточного шаблону шляху.

```tsx
import type { PageLayoutContext } from "@arc/framework/web";

export default function Layout({ children }: PageLayoutContext) {
  return <main>{children}</main>;
}
```

`title` макета задає спільний заголовок, який може перевизначити сторінка. ARC додає CSS макета перед CSS сторінки. [Макет Workspace](../../examples/workspace/pages/layout.tsx)

## 7. Перевірте boundary та interaction

`npm run graph` показує browser state/action/resource/view, server operation/resource і shared contracts. Stand :3100 має All/Frontend/Backend/Boundaries та interaction traces. `npm run build:app` перевіряє browser reachability; repositories й Node adapters не повинні опинитися в manifest inputs. [Тести](testing.md) перевіряють реальні user flows.
