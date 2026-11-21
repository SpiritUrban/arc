# ARC documentation website

Третій окремий проєкт у репозиторії: публічний сайт ARC з landing page, документацією та introductory lessons. Це статичні HTML/CSS/JS, без ARC runtime/backend і із build-time підсвіткою highlight.js. Для tests використовується наявний root devDependency linkedom.

```sh
# з кореня репозиторію
npm run dev:docs-site   # http://localhost:4400
npm run build:site # website/dist
npm run test:site
```

З каталогу `website/` доступні `npm run dev`, `npm run build` і `npm test` після встановлення залежностей у корені.

build.mjs читає docs/, README.md та content/learn/, генерує HTML, source pages і search-index.json. Markdown у docs/ лишається source of truth; згенеровані website/dist файли не редагують і не комітять. Browser assets — у assets/, landing content — home.html. Редагування source потребує restart preview або повторного build; HMR немає.

Усі внутрішні URLs відносні, тому сайт працює як на domain root, так і під project path GitHub Pages. Output можна розмістити на будь-якому static host. Google Sites — інший сервіс: цей проєкт підготовлено для GitHub Pages, а не нативного редактора Google Sites.

Workflow `.github/workflows/docs-pages.yml` перевіряє та публікує `website/dist/` у GitHub Pages після змін у `main`. Для ручного запуску оберіть гілку `main`. [Офіційний сайт ARC](https://spiriturban.github.io/arc/) · [Запуски workflow](https://github.com/SpiritUrban/arc/actions/workflows/docs-pages.yml)

Детальніше: [керування сайтом](../docs/website.md).

Підсвітка синтаксису генерується під час build через highlight.js: TypeScript/JavaScript, JSON, shell, HTML/XML, CSS та YAML. Для Markdown code blocks задавайте мову після opening fence (ts, js, json, sh тощо); text і невідомі мови лишаються escaped plain text. Source pages визначають мову за розширенням. У browser не завантажується highlighter або CDN; Copy повертає початковий текст, теми мають окремі token colors.
