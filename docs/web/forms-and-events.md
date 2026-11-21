# Input, events та форми

Workspace використовує HTML-форми в TSX, вбудовані обмеження браузера та ARC bindings. Остаточну перевірку даних виконує серверний контракт.

## Поля та submit

```ts
const addUser = mutation(CreateUser, {
  refresh: [users],
});
```

```tsx
<form onSubmit={addUser}>
  <label>Ім’я <input name="name" required /></label>
  <label>Email <input name="email" type="email" required /></label>
  <button type="submit">
    Додати користувача
  </button>
</form>
```

ARC збирає значення полів за `name` і перевіряє їх за контрактом. `onSubmit` блокує повторне надсилання, поки виконується операція. Подія, дія і серверний виклик мають спільну трасу.

Якщо значення потрібне до надсилання, підключіть його через `bind:value`. У формі замовлень кількість живить підрахунок суми. Під час надсилання ARC бере значення з іменованого поля та перетворює його на число за контрактом. [Форма замовлень](../../examples/workspace/orders/page.tsx)

## Typed business error

```ts
const result = await create.call(input, ctx);
if (result.ok) {
  // result.value має output type із contract
} else if (result.kind === "business_error") {
  if (result.error === "EMAIL_EXISTS") {
    // Показати повідомлення; залишити input для виправлення.
  }
} else if (result.kind === "cancelled") {
  // Виклик скасовано.
} else {
  // result.fault містить safe code/status.
}
```

У Workspace результат доступний через `addUser().result`. Функція `failureMessage` перетворює `addUser().error` або помилку запиту на повідомлення для сторінки.

## Списки

```tsx
<tbody>
  {each(visibleOrders, {
    key: (order) => order.id,
    render: (order) => <tr><td>{order.product}</td></tr>,
  })}
</tbody>
```

`each` з `@arc/framework/web` створює одну прив’язку до джерела списку. Кожен елемент має унікальний ключ і повертає один HTML-елемент. ARC зберігає DOM незмінних елементів, вставляє нові й замінює змінені. Для звичайних об’єктів порівнюються значення їхніх полів. Шаблон елемента читає дані зі свого аргументу, а події можна делегувати через контейнер.

`bind:children={rows}` підходить для вмісту, який зручно замінити цілком. Рядкові значення в обох випадках стають текстовими вузлами.

У списку користувачів `map` і `key` зберігають DOM рядків, а `onClick` на кнопці змінює `selectedUser`. [Сторінка користувачів](../../examples/workspace/users/page.tsx)
