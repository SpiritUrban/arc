# Як писати frontend на ARC

Почніть із доменних операцій сторінки. У Workspace контракти `ListOrders`, `CreateOrder` і `UpdateOrder` задають читання, створення та редагування замовлень; TSX описує інтерфейс цих операцій. [ARC Workspace](../workspace-app.md)

## 1. Оберіть власника даних

| Потреба | API | Приклад Workspace |
| --- | --- | --- |
| Стан екземпляра сторінки | `view.state` | `search` |
| Спільний вибір | `state` | `selectedUser` |
| Похідні дані | функція або `derive` | `users.page.derived.visible`, `orders.list.query.select.visible` |
| Читання з сервера | `query` | `users`, `ordersData` |
| Запис на сервер | `mutation` | `addUser`, `createOrder` |

## 2. Розміщуйте код за feature

```text
examples/workspace/
  app.ts              # один logical application graph
  auth.ts             # серверний користувач поточного запиту
  user-selection.ts   # вибраний користувач і віддалений список
  users/
    contracts.ts   # browser-safe schemas і operation descriptors
    server.ts      # server repository, operation, module, REST
    page.tsx       # browser query, mutation і view
  orders/
    contracts.ts
    server.ts
    client.ts      # browser query/mutation definitions
    page.tsx       # browser query, mutation і view
  pages/            # file routes та layouts
    index.tsx
    orders/
      index.tsx
      [id].tsx
  styles.ts         # application CSS
  ui.ts             # binding та error-message helpers
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
  needs: selectedUser,
  refresh: users,
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

Після успішного запису використовуйте `refresh: query`, якщо треба перечитати список із сервера. Якщо відповідь містить повний актуальний запис, `update: query.replaceBy("id")` оновить рядок без додаткового запиту. На detail-сторінці `update: order.replace()` замінює весь query-вміст. [Оновлення query після mutation](../fullstack/remote-operations.md#оновлення-query-з-відповіді)

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
    _components/      # приватні компоненти, без маршрутів
    _shared.tsx       # приватний модуль, без маршруту
```

`index.tsx` відповідає адресі каталогу, а квадратні дужки позначають параметр. Кореневий `layout.tsx` обгортає всі сторінки; вкладений макет обгортає сторінки лише у своєму розділі. Вкладені макети утворюють ланцюг від кореня до каталогу сторінки. Файли й каталоги з `_` на початку пропускаються пошуком маршрутів — зберігайте там приватні компоненти та спільний код. Усі TSX-модулі, імпортовані сторінкою, автоматично отримують реактивний JSX. Для адрес, які задаєте явно, доступний `web.pages`.

Кожна адреса відкривається напряму й через звичайне посилання. Внутрішні посилання перемикають сторінку без перезавантаження; спільні макети та їхній стан лишаються змонтованими. Код сторінки завантажується під час першого переходу до неї, а потім кешується браузером. URL, кнопки Back/Forward і відкриття адреси напряму працюють як звично. У Workspace `/orders` також є REST-маршрутом. Запит із `Accept: text/html` відкриває сторінку, а запит JSON викликає серверну операцію.

### Параметри маршруту

Сторінка з параметрами маршруту отримує їх через `params` у `PageContext`. Якщо вони повністю задають вхід контракту, `query(remoteClient, contract)` підставляє їх автоматично. Додаткові опції, як-от ключ кешу, можна передати третім аргументом; для складнішого відображення лишається `input`.

Для форми з іменованими полями `mutation(remoteClient, contract, options)` прив’язує мутацію до сторінки та додає параметри маршруту до даних форми. За потреби передайте власні `options.params`. Інші вузли можна прив’язати до сторінки через `own`. [Деталі замовлення](../../examples/workspace/pages/orders/[id].tsx)

Для об’єктних контрактів `query` і `mutation` автоматично передають лише ті параметри маршруту, які оголошено у вхідній схемі. Повний набір параметрів доступний через `PageContext.params`.

Якщо кілька операцій використовують спільний клієнт, прив’яжіть його один раз через `const { query, mutation } = bind(orderClient)` у функції сторінки. Далі `query(GetOrder)` та `mutation(UpdateOrder, { update })` отримують параметри маршруту й належать поточному екземпляру сторінки. [Деталі замовлення](../../examples/workspace/pages/orders/[id].tsx)

У каталозі сторінок ARC підключає кожен `layout.tsx` автоматично. У явній конфігурації шлях до кореневого макета задається через `layout` поруч із `pages`. Файл макета експортує функцію, яка отримує `children` для вкладеного вмісту та `route` з префіксом шляху цього макета.

```tsx
import type { PageLayoutContext } from "@arc/framework/web";

export default function Layout({ children }: PageLayoutContext) {
  return <main>{children}</main>;
}
```

`title` макета задає спільний заголовок, який може перевизначити сторінка. ARC додає CSS макета перед CSS сторінки. [Макет Workspace](../../examples/workspace/pages/layout.tsx)

## 7. Перевірте boundary та interaction

`npm run graph` показує browser state/action/resource/view, server operation/resource і shared contracts. Stand :3100 має All/Frontend/Backend/Boundaries та interaction traces. `npm run build:app` перевіряє browser reachability; repositories й Node adapters не повинні опинитися в manifest inputs. [Тести](testing.md) перевіряють реальні user flows.
