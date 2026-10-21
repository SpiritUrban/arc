# Тести та ARC Stand

[← Зміст](README.md)

## Тест операції без HTTP

Test harness сам створює Application, компілює його, викликає операцію та закриває ресурси. `provide` підміняє значення ресурсу, а не його визначення.

Приклад використовує готовий навчальний модуль:

```ts
import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { test as testOperation, error } from "@arc/framework";
import { getTask, tasksRepository } from "./tasks.ts";

nodeTest("missing task", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const result = await testOperation(getTask)
    .provide(tasksRepository, {
      create: (title) => ({ id, title, done: false }),
      find: () => undefined,
    })
    .run({ id });

  assert.deepEqual(result, error("TASK_NOT_FOUND"));
});
```

Імпортуйте той самий об’єкт ресурсу, який указаний у `needs`. Створення нового ресурсу з тим самим ID не є підміною.

Підмінений ресурс не відкривається і не закривається ARC. Гілка його реальних залежностей також не ініціалізується, якщо вона більше ніде не потрібна. Це дозволяє замінити repository і не піднімати його DB. Значення fake має відповідати типу всього ресурсу, включно з методами, які конкретний тест не викликає.

Вхідний контракт продовжує перевірятися. Для UUID-схеми передавайте валідний UUID, навіть коли fake не використовує ID.

## HTTP-тест без мережі

```ts
import assert from "node:assert/strict";
import { handler } from "@arc/framework";
import { createTasksApp } from "./tasks.ts";

const app = createTasksApp();
await app.compile();
try {
  const fetch = handler(app);
  const response = await fetch(
    new Request("http://localhost/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Test the HTTP adapter" }),
    }),
  );

  assert.equal(response.status, 201);
  const task = await response.json();
  assert.equal(task.title, "Test the HTTP adapter");
} finally {
  await app.close();
}
```

Цей тест перевіряє маршрутизацію, збирання input, contracts, виконання і JSON-відповідь. Він не перевіряє Node-сокет, Host-фільтр або ліміт body з `serve`; для цього потрібен тест із реальним сервером.

Для ізоляції створюйте Application фабрикою, як `createTasksApp`, замість повторного використання вже закритого default-export.

Запуск навчальних тестів:

```sh
node --import tsx --test docs/examples/tasks.test.ts
```

Основний набір перевірок фреймворку запускається `npm test`. Навчальні приклади лежать поза шаблоном `tests/*.test.ts`, тому виконуються окремою командою.

## Що перевіряти в прикладному коді

| Тип тесту         | Приклад                                                           |
| ----------------- | ----------------------------------------------------------------- |
| Бізнес-успіх      | Створений об’єкт має потрібні поля                                |
| Очікувана відмова | Відсутній запис повертає оголошений error                         |
| Контракт          | Некоректний input не доходить до repository                       |
| Авторизація       | Без Request/credentials capability відмовляє                      |
| Ресурс            | Успіх і exception не залишають відкриту транзакцію або connection |
| HTTP              | Параметри шляху, статус, формат response                          |

Перевіряйте поведінку, важливу для вашої функціональності. Тести компілятора, scheduler та загальних механізмів уже є у `tests/arc.test.ts`.

## Запуск Stand

```sh
npm run dev
# або навчальний application:
ARC_APP=docs/examples/tasks.ts npx arc stand
```

Відкрийте `http://localhost:3100`. Stand працює з тим самим Application у тому самому процесі. Виклики змінюють його справжній стан: створення завдання через Stand додає запис у repository цього запуску.

Інтерфейс періодично отримує runtime-дані, типово раз на дві секунди. Це polling, а не потік server-sent events чи WebSocket.

## Граф і контракти

Натисніть operation-вузол або оберіть операцію у списку. Панель показує схеми input/output, errors, effects, scope/план та sample. Ресурс-вузол можна вибрати для огляду визначення та failure injection; для запуску знову оберіть operation.

Граф відображає зібраний IR, а не виводить архітектуру з traces. RPM та p95 на вузлах операцій походять із runtime-викликів.

## Виконання запиту

1. Виберіть операцію.
2. Натисніть **Generate valid**, щоб заповнити JSON із `input.sample()`.
3. За потреби змініть поля та Authorization.
4. Виберіть **Operation** або **HTTP**.
5. Натисніть **Run operation**.

**Operation** викликає `app.execute` напряму. Stand створює Request з Authorization для request-capabilities, тому цей режим відрізняється від CLI `arc run`, який Request не створює. Результат — Result із `ok`.

**HTTP** будує Request і передає його локальному HTTP handler. Він перевіряє routing, input mapping, status та JSON-response, але не виконує мережевий round trip до порту 3000. Повертається `{ status, body }`. Якщо операція має кілька маршрутів, використовується перший знайдений.

**Generate invalid** зараз створює `{ "__invalid": true }`. Це базовий приклад невалідного об’єкта, а не повний набір граничних чи fuzz-тестів. Валідація UUID, min/max та інших обмежень перевіряється відповідно до схеми.

## Save as test

Після виклику в режимі Operation натисніть **Save as test**, потім **Run tests**. Зберігаються operation ID, input і очікуваний Result. Повторний запуск порівнює `JSON.stringify(actual)` з `JSON.stringify(expected)`.

Поточні обмеження:

- Тести живуть лише в пам’яті екземпляра Stand; перезапуск сервера видаляє їх. TypeScript-файли не генеруються.
- Authorization і Request не зберігаються. Для захищених операцій використовуйте кодові тести із fake-capability.
- Створення з випадковим UUID, поточним часом або іншим недетермінованим output може не пройти точне порівняння при повторі.
- Тест не скидає стан application-ресурсів, тому попередній запуск може вплинути на наступний.

Для стабільного автотестування використовуйте Node test runner та `test(operation)`; Stand корисний для швидкої ручної перевірки.

## Метрики й traces

Таблиця runtime показує:

| Поле      | Значення                                                                |
| --------- | ----------------------------------------------------------------------- |
| RPM       | Кількість завершених викликів за останні 60 секунд у збереженому буфері |
| p50 / p95 | Перцентилі тривалості завершених викликів із буфера, мілісекунди        |
| Errors    | Кількість traces зі статусом, відмінним від `ok`                        |

Очікувані бізнес-відмови теж входять до Errors. Перцентилі рахуються за всім поточним буфером, а не лише за останньою хвилиною. Буфер спільний для всіх операцій, типовий розмір — 500 traces; через це RPM під високим навантаженням є обмеженим спостереженням, а не повним лічильником ingress.

Виберіть trace зі списку, щоб побачити operation, status, total duration та spans. Spans охоплюють відкриття request-ресурсів і `run`, але не кожен метод repository чи SQL. HTTP parsing, передавання мережею та серіалізація поза executor не є окремими spans.

## Load generator

Виберіть операцію, input і режим, задайте Requests та Concurrency, натисніть **Start load**.

- Requests: від 1 до 1000 на запуск.
- Concurrency: від 1 до 25.
- Результат: completed, errors, durationMs, RPS, p50, p95.

Input фіксований для всіх викликів цього запуску. Автоматичного random dataset, налаштування цільового RPS, тривалості чи пошуку breaking point немає. Повторний create із тим самим email, наприклад, природно дасть бізнес-відмови через унікальність.

Генератор працює у спільному процесі й event loop. Режим HTTP проходить локальний handler, але не Node HTTP-сервер. Ці виміри допомагають дослідити поведінку операції, однак не замінюють зовнішній benchmark deployment.

## Failure injection

У панелі Failure injection:

1. Оберіть operation або request-resource.
2. Задайте Latency ms: 0–5000.
3. Задайте Error rate: 0–1, наприклад 0.2 для 20% імовірності.
4. Натисніть **Apply** і запустіть операцію.
5. Натисніть **Clear**, щоб прибрати ін’єкцію для цього вузла.

Затримка виконується перед `run` операції або `open` request-ресурсу. Імовірнісна помилка кидає `Fault('INJECTED_FAILURE', 503)`. Ін’єкція впливає на наступні виклики цього Application, включно зі звичайними HTTP-запитами.

Уже відкриті application-ресурси та їхні методи не перехоплюються. Вибір такого вузла у формі не симулює відмову DB-пулу чи його запитів. Для цього потрібен request-resource навколо відповідної роботи або власний fake/adapter.

## API Stand

Програмний інструмент може звертатися до локального API:

| Метод і шлях          | Дані                                                           |
| --------------------- | -------------------------------------------------------------- |
| `GET /api/graph`      | Architecture IR                                                |
| `GET /api/live`       | metrics, traces, faults, tests                                 |
| `POST /api/run`       | `{ operation, input, mode?, authorization? }`                  |
| `POST /api/test/save` | `{ operation, input, expected, name? }`                        |
| `POST /api/test/run`  | `{}`                                                           |
| `POST /api/load`      | Дані run та `{ count, concurrency }`                           |
| `POST /api/fault`     | `{ node, latencyMs?, errorRate? }` або `{ node, clear: true }` |

POST потребує `Content-Type: application/json`. Якщо є Origin, він має збігатися з origin Stand. Вбудований Stand орієнтований на локальну розробку; production roles, environments, DB console, історичне сховище та захист окремою системою login наразі відсутні.
