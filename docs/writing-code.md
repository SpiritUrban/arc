# Як писати код на ARC 0.3

[← Зміст](README.md)

Цей розділ будує модуль завдань: `POST /tasks` створює завдання, `GET /tasks/:id` читає його. Повний код міститься в [`examples/tasks.ts`](examples/tasks.ts), тести — у [`examples/tasks.test.ts`](examples/tasks.test.ts).

## 1. Організуйте код за функціональністю

Для невеликої функціональності достатньо одного файлу. Коли модуль зростає, розділіть його так:

```text
src/tasks/
  task.schema.ts          контракт і тип Task
  tasks.repository.ts     ресурс доступу до даних
  create-task.ts          операція створення
  get-task.ts             операція читання
  index.ts                module та HTTP-маршрути
```

`src/app.ts` збирає feature-модулі. Бізнес-правила без I/O зручно виносити у звичайні pure-функції всередині feature-каталогу. Вони не потребують реєстрації у ARC.

Ідентифікатори називайте за предметною областю: `tasks.create`, `tasks.get`, `tasks.repository`. Ключ у `needs` — локальне ім’я в контексті, а `id` — глобальне ім’я вузла в графі.

## 2. Опишіть контракт

```ts
import { s, type Infer } from "@arc/framework";

export const Task = s.object({
  id: s.uuid(),
  title: s.string({ min: 1, max: 200 }),
  done: s.boolean(),
});

export type Task = Infer<typeof Task>;
```

Те саме визначення використовується для перевірки даних, TypeScript-типу, JSON Schema, OpenAPI та генерації прикладу в Stand.

```ts
Task.parse({
  id: "00000000-0000-4000-8000-000000000001",
  title: "Read ARC docs",
  done: false,
});

const example = Task.sample();
const jsonSchema = Task.json;
```

`parse` кидає `ValidationError`, якщо значення не відповідає схемі. `s.object` відхиляє невідомі поля. Для відсутніх необов’язкових полів використовуйте `.optional()`:

```ts
const SearchTasks = s.object({
  query: s.string({ min: 1 }).optional(),
  limit: s.int({ min: 1, max: 100 }).optional(),
});
```

Необов’язковість означає `undefined` або відсутнє поле; `null` автоматично не дозволяється. Значення за замовчуванням задавайте у логіці: `const limit = input.limit ?? 20`.

Поточний синтаксис обмежень — `s.string({ min: 2 })`, а не fluent-виклик `.min(2)`. Дивіться повний перелік у [довіднику схем](api.md#схеми).

## 3. Винесіть доступ до даних у ресурс

```ts
import { randomUUID } from "node:crypto";
import { resource } from "@arc/framework";
import type { Task } from "./task.schema.ts";

export const tasksRepository = resource({
  id: "tasks.repository",
  scope: "application",
  effects: ["memory.read", "memory.write"],
  open() {
    const tasks = new Map<string, Task>();
    return {
      create(title: string): Task {
        const task = { id: randomUUID(), title, done: false };
        tasks.set(task.id, task);
        return task;
      },
      find(id: string): Task | undefined {
        return tasks.get(id);
      },
    };
  },
});
```

Кожен Application отримує власну Map під час `start()`. Не створюйте Map на рівні модуля, якщо не хочете ділити її між різними екземплярами застосунку й тестами.

Реальна DB-реалізація може мати async-методи. У такому разі очікуйте їх через `await` у `run`. Створення пулу та його закриття оформлюйте як `open`/`close`, а конфігурацію передавайте через замикання або інший application-ресурс.

## 4. Напишіть операцію

```ts
import { operation, s, ok } from "@arc/framework";
import { Task } from "./task.schema.ts";
import { tasksRepository } from "./tasks.repository.ts";

export const createTask = operation({
  id: "tasks.create",
  input: s.object({ title: s.string({ min: 1, max: 200 }) }),
  output: Task,
  needs: { tasks: tasksRepository },
  run({ input, tasks }) {
    return ok(tasks.create(input.title));
  },
});
```

У `run` вже потрапляє перевірений input, а `tasks` має тип значення, поверненого `tasksRepository.open()`. Сам `run` не отримує HTTP Response або довільний registry сервісів.

Поверніть `ok(value)`, а не просто `value`. Успішне значення також перевіряється за output-схемою. Для async-операції позначте `async run` і поверніть такий самий Result.

## 5. Оголосіть очікувані помилки

```ts
import { operation, s, ok, error } from "@arc/framework";
import { Task } from "./task.schema.ts";
import { tasksRepository } from "./tasks.repository.ts";

export const getTask = operation({
  id: "tasks.get",
  input: s.object({ id: s.uuid() }),
  output: Task,
  needs: { tasks: tasksRepository },
  errors: { TASK_NOT_FOUND: 404 },
  run({ input, tasks }) {
    const task = tasks.find(input.id);
    return task ? ok(task) : error("TASK_NOT_FOUND");
  },
});
```

`error` можна доповнити деталями: `error('TASK_NOT_FOUND', { id: input.id })`. Для типізованих деталей оголосіть `errors: { TASK_NOT_FOUND: { status: 404, details: s.object({ id: s.uuid() }) } }` та поверніть `fail("TASK_NOT_FOUND", { id: input.id })` через operation-local ctx.fail.

Відсутність завдання є нормальною бізнес-ситуацією. Помилка мережі чи зламаний DB connection може залишитися exception. HTTP-адаптер перетворить невідомий exception на 500 `INTERNAL_ERROR` без тексту exception у відповіді.

`errors` типізує union business codes; operation-local `fail` перевіряє код і details. Runtime додатково валідує код і details schema. Глобальний `error` збережений для простих числових contracts; не стирайте inferred operation type широкими анотаціями.

## 6. Зберіть feature-модуль та application

```ts
import { module, http } from "@arc/framework";
import { createTask } from "./create-task.ts";
import { getTask } from "./get-task.ts";

export const tasks = module({
  id: "tasks",
  operations: [createTask, getTask],
  routes: [
    http.post("/tasks", createTask, { status: 201 }),
    http.get("/tasks/:id", getTask),
  ],
});
```

У `src/app.ts`:

```ts
import { application } from "@arc/framework";
import { tasks } from "./tasks/index.ts";

export default application({ modules: [tasks] });
```

Не викликайте `compile()` у default-export entrypoint для CLI: CLI зробить це сам. Якщо запускаєте application програмно, викликайте `compile`, потім `start` перед будь-яким `execute` та `close` у `finally`.

Масив `operations` робить намір модуля явним. Операції, указані тільки в `routes`, компілятор теж знаходить. Досяжні через `needs` ресурси реєструються автоматично.

## 7. Запустіть готовий навчальний приклад

Код попередніх кроків уже зібраний у `docs/examples/tasks.ts`. Без копіювання файлів:

```sh
npm run build
ARC_APP=docs/examples/tasks.ts npx arc stand
```

В іншому терміналі:

```sh
curl -X POST http://localhost:3000/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Read the ARC documentation"}'
```

Скопіюйте `id` із відповіді в наступний запит:

```sh
curl http://localhost:3000/tasks/REPLACE_WITH_ID
```

Для перенесення прикладу до основного застосунку розкладіть визначення у `src/tasks/` за схемою вище та додайте модуль до `modules` у `src/app.ts`.

## Авторизація через request-capability

Транспортні деталі зручно читати у request-ресурсі, а в операцію передавати вже перевірене значення:

```ts
import { capability, Fault } from "@arc/framework";

const currentUserId = capability({
  id: "auth.currentUserId",
  scope: "request",
  open({ request }) {
    const token = request?.headers.get("authorization");
    if (token !== "Bearer demo-token") throw new Fault("UNAUTHORIZED", 401);
    return "demo-user";
  },
});
```

Підключіть його до потрібної операції через `needs: { userId: currentUserId }`. Інші операції не відкриватимуть цей ресурс. Приклад порівнює фіксований токен лише для пояснення; у реальному застосунку capability має використовувати ваш механізм перевірки credentials.

`open` може не отримати `request`, наприклад при прямому CLI чи queue-виклику. Визначте поведінку цього випадку явно. Під час тесту можна підмінити capability через `.provide(currentUserId, 'test-user')`.

## Ресурси із залежностями та cleanup

Транспорто-незалежний приклад request-буфера:

```ts
const requestBuffer = resource({
  id: "report.buffer",
  scope: "request",
  open: () => ({ chunks: [] as string[] }),
  close(buffer) {
    buffer.chunks.length = 0;
  },
});
```

Для залежностей додайте `needs` у сам ресурс. Його `open` отримає значення цих ресурсів за ключами `needs`. Наприклад, request-scoped транзакція може залежати від application-scoped DB-пулу.

ARC викликає `close` і після успіху, і після помилки. `close` зараз не отримує Result операції, тому автоматичний вибір commit/rollback потребує вашої окремої реалізації; не робіть безумовний commit у cleanup.

## Скасування і таймаути

`signal` передається ресурсам та операції. Для зовнішнього HTTP можна передати його далі:

```ts
async function loadRemote(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  return response.json();
}
```

Для програмного виклику: `app.execute(id, input, { signal: AbortSignal.timeout(1000) })`. Executor перевіряє signal перед відкриттям request-ресурсів, перед і після `run`, успадковує його у nested calls та скасовує injected delays. Він не перериває довільний JavaScript і не скасовує вже початий `open` автоматично: I/O має саме реагувати на signal. HTTP bridge реагує на `aborted` вхідного Node-запиту та закриття response під час streaming; це не універсальна гарантія переривання будь-якої бізнес-операції.

## Правила для повсякденного коду

- Описуйте зовнішні залежності через `needs`, щоб вони були видимі у графі й підмінялися в тестах.
- Тримайте input/output серіалізовними для HTTP та Stand. Поточні схеми працюють із JSON-подібними значеннями.
- Вибирайте request scope для користувача, тимчасового стану та транзакцій; application — для спільних клієнтів і пулів.
- Не зберігайте request-дані у спільному application-ресурсі без власної моделі конкурентного доступу.
- Не покладайтеся на порядок ключів `needs`: request-ресурси відкриваються, щойно готові саме їхні dependencies.
- Задавайте успішний HTTP-статус у маршруті, очікувані помилки — в операції.
- Створюйте новий Application для ізольованого тестового сценарію, коли потрібен реальний стан ресурсів.

## Вкладений сценарій

```ts
import { operation, s } from "@arc/framework";
import { Task } from "./task.schema.ts";
import { getTask } from "./get-task.ts";

export const readTask = operation({
  id: "tasks.read",
  input: s.object({ id: s.uuid() }),
  output: Task,
  errors: getTask.errors,
  calls: { getTask },
  async run({ input, call }) {
    return call("getTask", { id: input.id });
  },
});
```

Батьківська operation тут явно приймає child business errors через `errors: getTask.errors`. Для іншого публічного контракту перевірте child Result та перетворіть помилку через свій `fail`; невідомий батьківському контракту код не можна просто передати нагору.

Оголосіть `calls: { getTask }`, а всередині run використовуйте `await call("getTask", { id })`. Child input/output виводяться зі схем; calls видимі в IR. Shared request-resource не відкривається повторно. Для незалежного root-виклику використовуйте app.execute або client. [Подробиці lifecycle та trace](architecture.md).

## Явна async instrumentation

Навчальний `tasksRepository` вище синхронний і не інструментований. Для спостереження та failure injection у виклик application-сервісу оголосіть async boundary:

```ts
import { resource } from "@arc/framework";

const titleLookup = resource({
  id: "tasks.titleLookup",
  scope: "application",
  instrument: ["find"],
  open: () => ({
    async find(id: string) {
      return `Task ${id}`;
    },
  }),
});
```

В операції додайте `needs: { titleLookup }` та викличте `await titleLookup.find(input.id)`. У IR з’явиться effect `tasks.titleLookup.find`. Це явне обгортання async methods application-ресурсів; синхронні методи прикладу не слід позначати instrument без зміни їхнього контракту на Promise. Докладніше — [API](api.md#resource--capability) та [Stand](testing-and-stand.md#failure-injection).

## ARC Web / Fullstack 0.3

Цей розділ описує server API. Browser та fullstack: [Web guide](web/getting-started.md), [remote contracts](fullstack/remote-operations.md), [Stand graph і interaction traces](stand/README.md). Поточний unified IR має version 3; IR v2 приклади аудиту 0.2 є історичними.

Frontend код кореневого застосунку: [покроковий посібник](web/writing-frontend.md), [forms/events](web/forms-and-events.md), [Workspace structure](workspace-app.md).
