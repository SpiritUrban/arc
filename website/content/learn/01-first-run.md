# 01. Запустіть перший застосунок

Почнемо з робочого проєкту, щоб одразу побачити browser, server і Stand. Потрібен Node.js 22.18 або новіший.

## Встановлення

Завантажте репозиторій ARC та відкрийте його корінь у terminal:

```sh
npm install
npm run build
npm run dev
```

Відкрийте http://localhost:3000 — це ARC Workspace. На http://localhost:3100 працює Stand. Перший — користувацький застосунок, другий — інструмент для розробника.

## Зробіть першу дію

1. Створіть користувача з унікальним email.
2. Додайте йому замовлення з кількістю 2.
3. Переконайтеся, що сума дорівнює 50 ₴.
4. Перейдіть у Stand і знайдіть users.create та orders.create у graph.

Repositories тут in-memory: перезапуск server скине зміни. Вибір користувача — demo authorization через UUID, не production login.

## Розберіться зі структурою

- framework/ — бібліотека ARC, яку використовує application.
- examples/workspace/ — fullstack-приклад Workspace із користувачами та замовленнями.
- examples/fullstack-tasks/ — окремий малий Tasks application.
- website/ — цей статичний сайт. Він не виконує ARC server operations.

```sh
npm run dev:web       # pure browser Counter
npm run dev:fullstack # маленький Tasks example
```

Не запускайте всі приклади на однакових портах одночасно. Для іншої пари портів: PORT=4000 STAND_PORT=4100 npm run dev.

## Результат уроку

Ви запустили fullstack application і відрізняєте його від Stand та прикладів. Далі оголосимо server operation.
