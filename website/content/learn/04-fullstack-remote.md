# 04. Browser → server через remote

Boundary має бути видимою в коді. Browser не може прямо використовувати database/server resource; він викликає exposed operation через remote bridge.

## Один shared contract

```ts
import { s, operationContract } from "@arc/framework/core";
export const Hello = operationContract({
  id: "hello",
  input: s.object({ name: s.string({ min: 1 }) }),
  output: s.string(),
  expose: { web: true },
});
```

Server додає implementation:

```ts
import { operation, ok } from "@arc/framework/server";
import { Hello } from "./contract.ts";
export const hello = operation({
  ...Hello,
  run: ({ input }) => ok(`Привіт, ${input.name}!`),
});
```

Browser імпортує descriptor, не implementation:

```ts
import { remoteClient } from "@arc/framework/fullstack";
import { action } from "@arc/framework/web";
import { Hello } from "./contract.ts";
const client = remoteClient(Hello, { id: "hello.remote" });
export const greet = action({
  id: "hello.action",
  needs: { client },
  run: (_, ctx) => client.call({ name: "ARC" }, ctx),
});
```

Зареєструйте hello в server application.operations, а browser view/action — у web.nodes; web.entry задає browser bootstrap. CLI обслуговує internal transport та frontend з одного origin. Для читання server data використовуйте remote(Hello,{id,input}), який надає data/loading/error/stale.

## Політика exposure

expose.web має бути true на server operation. Browser descriptor не може сам надати доступ до приватної operation. Transport перевіряє contracts і не віддає raw internal exception. Application authorization лишається server responsibility.

## Result, а не лише exception

Remote result відрізняє success, business_error, fault та cancelled. Codes і optional details беруться з contract. Action може повертати цей Result та invalidates потрібні resources після success.

```text
hello.action [browser]
  → hello.remote [browser]
    REMOTE_CALLS → hello [server]
```

Shared schema не означає shared secrets або runtime values. Server repository не має потрапити до browser bundle.

## Результат уроку

Ви зв’язали browser action із server operation без дублювання DTO/endpoint path. Повний код: examples/fullstack-tasks/; більший застосунок: src/.
