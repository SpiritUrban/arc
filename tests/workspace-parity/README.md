# Браузерний паритет Workspace

Один набір сценаріїв запускається в Chromium на зібраних ARC і React Workspace. Playwright сам збирає застосунки й запускає два локальні сервери на портах 4428 і 4429. Кожен запуск починається з окремого in-memory сховища для кожного застосунку.

З кореня репозиторію:

```sh
npm ci
npm ci --prefix examples/react-workspace
npm ci --prefix tests/workspace-parity
npm exec --prefix tests/workspace-parity -- playwright install chromium --only-shell
npm --prefix tests/workspace-parity test
```

Для прогону лише одного застосунку додайте `-- --project=arc` або `-- --project=react`. Трасу невдалої перевірки Playwright зберігає в `test-results/`.

[Сценарії й початкові дані](../../docs/workspace-parity.md)

## Порівняльний прогін

```sh
npm --prefix tests/workspace-parity run benchmark
WORKSPACE_API_DELAY_MS=40 npm --prefix tests/workspace-parity run benchmark
```

Прогін вимірює застосунки послідовно в одному Chromium worker і додатково відкриває ARC Stand на порту 4430. Сирі спостереження кожної фази submit, обсяг JS і діагностика друкуються в рядках `WORKSPACE_BENCH`. Другий запуск затримує доставку кожної з двох відповідей після submit на 40 мс. [Порівняння й результати](../../docs/workspace-comparison.md)

## Експеримент із полем замовлення

В окремому checkout від `1d2afd3` застосуйте [патч](reference-field.patch). Шлях у команді вказує на патч із поточної версії репозиторію. Потім встановіть залежності командами з розділу запуску та виконайте цільовий тест.

```sh
git apply --unidiff-zero /path/to/reference-field.patch
npm --prefix tests/workspace-parity test -- -g "reference experiment"
```

[Повторний патч](reference-field-shared-form.patch) застосовується на коміті, який додав `examples/workspace/orders/fields.tsx`. Виконайте ті самі команди з цим патчем для перевірки після виділення спільної форми.
