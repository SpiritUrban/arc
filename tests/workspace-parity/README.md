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
