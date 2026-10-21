# Початок роботи

[← Зміст](README.md)

## Встановлення та запуск

Потрібен Node.js 22.18 або новіший. Реалізацію перевірено на Node.js 24. Команди нижче виконуються з кореня репозиторію.

```sh
npm install
npm run dev
```

Відкрийте:

- `http://localhost:3000/health` — endpoint застосунку;
- `http://localhost:3100` — ARC Stand;
- `http://localhost:3000/openapi.json` — контракт HTTP API у форматі OpenAPI 3.1.

`npm run dev` компілює граф, відкриває application-ресурси та запускає два сервери. Автоматичного перезапуску при редагуванні файлів зараз немає: після зміни коду перезапустіть команду.

`npm start` запускає тільки HTTP-застосунок. Ctrl+C або SIGTERM запускає штатне завершення: CLI закриває сервери, потім застосунок чекає активні операції й закриває application-ресурси.

## Як організовано репозиторій

```text
framework/              npm workspace @arc/framework
  src/                  код фреймворку, незалежний від прикладу
  arc.mjs               точка входу CLI
src/                    застосунок користувача фреймворку
  app.ts                композиція application
  users/                feature-модуль користувачів
  orders/               feature-модуль замовлень
tests/                  перевірки реалізації ARC
docs/                   посібник і навчальні приклади
```

Додавайте бізнес-функціональність у `src/`. У `framework/` змінюйте самі механізми ARC. Workspace дозволяє імпортувати фреймворк за іменем пакета:

```ts
import { operation, resource, s, ok } from "@arc/framework";
```

## Команди

| Команда                            | Призначення                                   |
| ---------------------------------- | --------------------------------------------- |
| `npm run dev`                      | Application та Stand                          |
| `npm start`                        | Тільки application HTTP                       |
| `npm run graph`                    | Граф застосунку у JSON                        |
| `npm run inspect -- orders.create` | Один вузол, його контракт і план залежностей  |
| `npx arc run system.health '{}'`   | Прямий виклик операції без HTTP               |
| `npm test`                         | Тести з `tests/*.test.ts`                     |
| `npm run typecheck`                | Перевірка TypeScript без генерації файлів     |
| `npm run build`                    | Генерація JavaScript і declarations у `dist/` |

CLI підтримує `stand`, `dev` (синонім `stand`), `start`, `graph`, `inspect <id>`, `run <id> <json>`. Окремої CLI-команди `arc test` у поточній версії немає.

`graph` та `inspect` теж виконують `compile()`, тому можуть відкривати зовнішні application-ресурси. Після виведення результату вони закривають застосунок. `run` не створює HTTP Request: операціям із HTTP-авторизацією для ручної перевірки краще передавати заголовки через Stand або HTTP.

## Налаштування

| Змінна оточення | Типове значення | Призначення                                                             |
| --------------- | --------------- | ----------------------------------------------------------------------- |
| `ARC_APP`       | `src/app.ts`    | Файл із default-export об’єкта Application; шлях від поточного каталогу |
| `PORT`          | `3000`          | Порт HTTP-застосунку                                                    |
| `STAND_PORT`    | `3100`          | Порт Stand                                                              |

```sh
PORT=4000 STAND_PORT=4100 npm run dev
ARC_APP=docs/examples/tasks.ts npx arc stand
```

Поточний CLI прив’язує сервери до `127.0.0.1`. Вбудований Node HTTP bridge приймає Host лише `localhost`, `127.0.0.1` або `[::1]`, із необов’язковим портом. Публічний домен чи розгортання за proxy потребують окремого адаптера або зміни цієї політики; одного `host: '0.0.0.0'` недостатньо.

## Перші запити

```sh
curl http://localhost:3000/users
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"Olena","email":"olena@example.com"}'
```

Успішна HTTP-відповідь містить саме значення output, без обгортки `ok`:

```json
{ "id": "...", "name": "Olena", "email": "olena@example.com" }
```

Повторний email поверне 409 та об’єкт очікуваної помилки:

```json
{ "ok": false, "error": "EMAIL_EXISTS" }
```

Для замовлень приклад очікує demo-токен — UUID наявного користувача:

```sh
curl -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer 00000000-0000-4000-8000-000000000001' \
  -d '{"product":"ARC Book","quantity":2}'
```

Ця capability демонструє залежність від авторизації, але не перевіряє JWT чи підписаний access token. Дані користувачів і замовлень зберігаються в пам’яті процесу.

## Використання пакета в іншому проєкті

Встановіть каталог фреймворку як локальну залежність:

```sh
npm install /absolute/path/to/arc/framework
```

Створіть ESM-проєкт (`"type": "module"` у `package.json`) і `src/app.ts` із default-export результату `application(...)`. Запускайте `npx arc stand` із каталогу свого проєкту.

Пакет наразі експортує TypeScript-вихідні файли. CLI сам реєструє `tsx`; для власного запускного TypeScript-файлу використовуйте `node --import tsx path/to/main.ts` з установленим у вашому проєкті `tsx`. Звичайний запуск згенерованого JS без TypeScript loader не є окремо налаштованим distribution-процесом цього репозиторію.
