# Input, events та форми

Workspace використовує HTML-форми в TSX, вбудовані обмеження браузера та ARC bindings. Остаточну перевірку даних виконує серверний контракт.

## Поля та submit

```ts
const { fields, submit: addUser } = remoteForm(CreateUser, {
  fields: { name: textField(), email: textField() },
  refresh: [users],
});
```

```tsx
<form on:submit={addUser}>
  <label>Ім’я <input required bind:value={fields.name} /></label>
  <button type="submit" bind:disabled={addUser.running}>
    Додати користувача
  </button>
</form>
```

`bind:value={fields.name}` записує значення state у поле й оновлює state на події `input`. Значення DOM-поля є рядком. У формі замовлень `integerField(1)` перетворює рядок на число перед запитом. Ціле значення та межі перевіряє серверна схема.

`on:submit={addUser}` скасовує стандартну навігацію й одночасно допускає лише один submit цієї дії. `bind:disabled` показує цей стан у DOM. Подія, дія і серверний виклик зберігають спільний trace.

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

У Workspace `remoteForm` надає цей результат через `submit.result`, а `failureMessage` перетворює `submit.error` або помилку ресурсу на повідомлення. Raw server exceptions не показуються в UI. Errors з optional details schema також типізуються contract union.

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

У [списку користувачів](../../examples/workspace/users/page.tsx) контейнер також має `bind={select}`. Цей явний binding знаходить натиснутий рядок через `closest("[data-user]")` і змінює `selectedUser`.
