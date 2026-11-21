# 02. Контракт, operation і resource

Operation — конкретний сценарій із input/output contract та явними dependencies. Resource дає доступ до application/request capability.

## Мінімальний server

Цей приклад можна зберегти як hello.mjs у корені після npm run build:

```js
import { application, operation, resource, s, ok } from "@arc/framework/server";

const greeting = resource({
  id: "greeting.config",
  open: () => ({ prefix: "Привіт" }),
});
const hello = operation({
  id: "greeting.hello",
  input: s.object({ name: s.string({ min: 1 }) }),
  output: s.string(),
  needs: { greeting },
  run: ({ input, greeting }) => ok(`${greeting.prefix}, ${input.name}!`),
});
const app = application({ operations: [hello] });
await app.compile();
await app.start();
try {
  console.log(await app.execute("greeting.hello", { name: "ARC" }));
} finally {
  await app.close();
}
```

Запустіть node hello.mjs. Expected result містить ok: true і value: Привіт, ARC!.

## Що відбулося

compile збирає IR і execution plan, але не викликає resource.open. start відкриває application resource. execute перевіряє input, отримує dependencies та перевіряє output. close звільняє resources.

```text
greeting.hello [operation/server]
  DEPENDS_ON → greeting.config [resource/server]
```

needs — явна dependency, а не пошук service за string ID усередині run. Для виклику іншої operation існує declared calls та ctx.call; не створюйте новий application execution, якщо потрібен той самий request scope.

## Business errors

Для очікуваної business відмови задавайте errors у operation та використовуйте operation-local fail. Exception означає fault. Input/output schemas використовуються також Stand та transport adapters.

## Результат уроку

Ви написали server scenario з lifecycle і graph dependency. Наступний урок — browser state та DOM bindings.
