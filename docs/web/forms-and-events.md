# Input, events та форми

ARC поки не має forms framework, JSX `bind:value` чи form() API. Workspace використовує звичайний HTML form, native constraints та явні ARC bindings. Server contract validation залишається остаточною перевіркою даних.

## Двосторонній input

```ts
import { state, binding } from "@arc/framework/web";

const name = state({ id: "profile.name", initial: "" });
const value = binding({
  id: "profile.name.value",
  type: "property",
  name: "value",
  sources: [name],
});
const edit = binding({
  id: "profile.name.edit",
  type: "event",
  name: "input",
  sources: [name],
  handler(event, trace) {
    name._trace = trace;
    name.set((event.target as HTMLInputElement).value);
  },
});
```

У view.setup прив’яжіть обидва bindings до того самого input. Property binding переносить state у DOM; event callback переносить DOM value у state. `_trace` — низькорівневе поле поточного runtime для continuity, яке використовує [src/ui.ts](../../src/ui.ts); всередині action використовуйте ctx.set. String input зберігає також проміжні значення, наприклад порожню кількість, а action перетворює quantity у Number перед contract validation.

## Submit та observable action state

Для звичайного button click binding може напряму мати `handler: addUser`; тоді graph автоматично отримує action dependency і TRIGGERS. `input` — фіксоване значення для action.execute, не mapper.

Для native form потрібно preventDefault. Callback приховує action від статичного closure analysis, тому Workspace явно додає graph relation:

```ts
const submit = binding({
  id: "users.submit",
  type: "event",
  name: "submit",
  sources: [],
  handler(event, trace) {
    event.preventDefault();
    if (!addUser.running.get()) {
      return addUser.execute(undefined, { trace });
    }
  },
});
submit.dependencies = [...(submit.dependencies ?? []), addUser];
submit.relations = [
  ...(submit.relations ?? []),
  { to: addUser, kind: "TRIGGERS" },
];

const disabled = binding({
  id: "users.submit.disabled",
  type: "property",
  name: "disabled",
  sources: [addUser.running],
});
```

bind(submit, form), bind(disabled, submitButton). Return Promise з handler, щоб framework міг перехопити rejection як binding.error telemetry. Додаткова перевірка running у callback блокує повторний submit навіть до наступної DOM propagation.

Input constraints у Workspace: required, minlength/maxlength, type=email, quantity min=1/max=100/step=1. Native validation не є authorization чи заміною server schema. Помилки load/mutation відображаються окремими text bindings у role=alert; loading — окремим status binding.

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

У Workspace action повертає цей Result; action.error і resource.error читає `failureMessage` helper. Raw server exceptions не показуються в UI. Errors з optional details schema також типізуються contract union.

## Списки та безпечне відображення

`type: "text"` пише textContent і підходить для довільного user text. Workspace list/table використовує property binding name=innerHTML: helper escapeHTML екранує кожне динамічне string значення до інтерполяції. ARC не санітизує довільний innerHTML автоматично. Статичні шаблони view.setup не містять user input.

List region замінюється як одне binding, без повторного view setup; keyed row reconciliation немає. Event delegation на стабільному контейнері з closest('[data-user]') дає вибирати нові rows без ручного додавання listener до кожного елемента. Handler змінює selectedUser, а derived selection і orders resource реагують через graph.
