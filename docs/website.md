# Сайт документації ARC

Офіційний сайт із документацією та уроками живе в `website/`. Він працює без ARC runtime. Команди для Workspace і навчальних застосунків зібрані в [таблиці локального запуску](../README.md#локальний-запуск).

## Що є на сайті

- Landing page: пояснення ARC Server/Web/Fullstack, graph illustration та Get Started.
- Документація з sidebar, table of contents, code blocks і copy buttons.
- П’ять уроків: перший запуск, operation/resource, reactive view, remote boundary, тести/Stand.
- Локальний пошук, dark/light theme, responsive/mobile navigation.
- Статичні сторінки code files, на які посилається документація.

Diagram на головній — ілюстрація declared architecture. Це не live Stand і не runtime telemetry.

## Локальний запуск і build

```sh
npm install
npm run dev:docs-site
```

URL: http://localhost:4400. Інший port: SITE_PORT=4500 npm run dev:docs-site. Source edits не застосовуються автоматично: перезапустіть dev script.

```sh
npm run build:site
npm run test:site
```

Для генерації потрібні Node 22.18+, repository files та root build dependency highlight.js: спочатку npm install. Framework build для website не потрібний. Для site tests потрібен root linkedom devDependency. Static output — website/dist; це незалежно від .arc/web, куди збираються ARC application frontends.

## Де редагувати матеріали

| Що змінюється                      | Джерело                    |
| ---------------------------------- | -------------------------- |
| Головна сторінка                   | website/home.html          |
| Стилі, favicon                     | website/assets/            |
| Search/theme/tabs/copy/menu        | website/assets/site.js     |
| Документація                       | docs/**/*.md               |
| Уроки                              | website/content/learn/*.md |
| Layout, sidebar, Markdown renderer | website/build.mjs          |

Після зміни docs повторіть build:site. Builder підтримує headings/anchors, paragraphs, fenced code, прості tables/lists/quotes та inline links/code/emphasis. Це обмежений repository renderer, не повна реалізація CommonMark/MDX. Raw HTML із Markdown екранується; HTML landing page редагується окремо. Нові основні sidebar entries додаються в navigation у build.mjs; усі Markdown docs також доступні через search.

## GitHub Pages

GitHub Pages використовує GitHub Actions як джерело публікації. Workflow збирає та перевіряє сайт після змін у `main` і публікує `website/dist/` у середовищі `github-pages`. Для повторної публікації відкрийте workflow та запустіть **Run workflow** для гілки `main`.

[Офіційний сайт ARC](https://spiriturban.github.io/arc/) · [Запуски workflow](https://github.com/SpiritUrban/arc/actions/workflows/docs-pages.yml)

Усі generated URLs відносні: сайт працює і на https://owner.github.io/, і на https://owner.github.io/repository/. Немає client-side router, rewrite rules чи server fallback. .nojekyll додається у output. Для іншого static host просто завантажте website/dist.

Google Sites — інший продукт і не є звичайним хостингом цієї директорії. Поточна реалізація орієнтована на GitHub Pages/static hosting.

## Перевірки та межі

Site tests перевіряють усі generated local routes/assets/anchors під repository prefix, documents search index, Get Started, code escaping і client interactions (tabs/search/theme/copy/mobile toggle). HTTP smoke перевіряє статичні відповіді. VM/Linkedom tests не підтверджують visual rendering у реальному браузері.

Сайт має український текст і поточний API ARC. SSR/SSG runtime targets ARC не стають реалізованими від появи цього сайту: website build — окремий static generator. Немає user accounts, CMS, server search, analytics, HMR чи ARC backend deployment.

Підсвітка синтаксису генерується під час build через highlight.js: TypeScript/JavaScript, JSON, shell, HTML/XML, CSS та YAML. Для Markdown code blocks задавайте мову після opening fence (ts, js, json, sh тощо); text і невідомі мови лишаються escaped plain text. Source pages визначають мову за розширенням. У browser не завантажується highlighter або CDN; Copy повертає початковий текст, теми мають окремі token colors.
