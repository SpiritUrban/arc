import { highlightCode } from "./highlight.mjs";
import { readFile, writeFile, mkdir, readdir, cp, rm } from "node:fs/promises";
import { resolve, relative, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
export const siteDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(siteDir, "..");
const { version } = JSON.parse(
  await readFile(join(repo, "framework/package.json"), "utf8"),
);
export const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
async function walk(dir) {
  const items = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      items.map((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : join(dir, e.name),
      ),
    )
  ).flat();
}
const route = (file) => {
  const path = relative(repo, file).replaceAll("\\", "/");
  if (path.startsWith("website/content/learn/"))
    return path.replace("website/content/", "").replace(/\.md$/, ".html");
  if (path.endsWith(".md") && path.startsWith("docs/"))
    return path.replace(/README\.md$/, "index.html").replace(/\.md$/, ".html");
  if (path === "README.md") return "project.html";
  if (path === "CHANGELOG.md") return "docs/changelog.html";
  return "source/" + path + ".html";
};
const navigation = [
  [
    "ПОЧАТОК",
    [
      ["docs/getting-started.html", "Get Started"],
      ["docs/workspace-app.html", "ARC Workspace"],
      ["docs/architecture.html", "Архітектура"],
      ["docs/api.html", "API Reference"],
    ],
  ],
  [
    "ARC WEB",
    [
      ["docs/web/index.html", "Огляд frontend"],
      ["docs/web/writing-frontend.html", "Пишемо frontend"],
      ["docs/web/state-and-derived.html", "State і derive"],
      ["docs/web/views.html", "Views і bindings"],
      ["docs/web/forms-and-events.html", "Форми та події"],
      ["docs/web/actions-and-resources.html", "Actions і resources"],
      ["docs/web/lifecycle.html", "Lifecycle"],
      ["docs/web/testing.html", "Тестування"],
    ],
  ],
  [
    "ARC SERVER",
    [
      ["docs/server/index.html", "Огляд server"],
      ["docs/writing-code.html", "Operations і resources"],
      ["docs/testing-and-stand.html", "Тести та Stand"],
    ],
  ],
  [
    "FULLSTACK",
    [
      ["docs/fullstack/overview.html", "Огляд fullstack"],
      ["docs/fullstack/remote-operations.html", "Remote operations"],
      ["docs/fullstack/runtime-boundaries.html", "Runtime boundaries"],
      ["docs/fullstack/tracing.html", "Tracing"],
      ["docs/stand/index.html", "Stand graph"],
    ],
  ],
  [
    "УРОКИ",
    Array.from({ length: 5 }, (_, i) => [
      `learn/${["01-first-run", "02-server-operation", "03-reactive-view", "04-fullstack-remote", "05-test-and-inspect"][i]}.html`,
      [
        "01 · Перший запуск",
        "02 · Server operation",
        "03 · Reactive view",
        "04 · Fullstack remote",
        "05 · Тести та Stand",
      ][i],
    ]),
  ],
  [
    "ПРО ПРОЄКТ",
    [
      ["docs/changelog.html", "Журнал змін"],
      ["docs/migration-0.3.html", "Міграція на IR v3"],
      ["docs/audit/web-fullstack-report.html", "Стан реалізації"],
    ],
  ],
];
function header(root, current = "") {
  return `<a class="skip-link" href="#content">До вмісту</a><header class="header"><div class="header-inner"><a class="logo" href="${root}index.html" aria-label="ARC головна"><span class="logo-mark">Λ</span>arc<span class="logo-period">.</span></a><span class="version">v${escape(version)}</span><nav aria-label="Головна навігація"><a ${current.startsWith("docs/") ? 'aria-current="page"' : ""} href="${root}docs/getting-started.html">Документація</a><a ${current.startsWith("learn/") ? 'aria-current="page"' : ""} href="${root}learn/index.html">Уроки</a><a href="${root}docs/workspace-app.html">Приклади</a></nav><div class="header-actions"><button class="search-open" data-search-open><span>⌕</span> Пошук <kbd>/</kbd></button><button class="theme-toggle" data-theme-toggle aria-label="Змінити колірну тему">◐</button><a class="small-cta" href="${root}docs/getting-started.html">Get Started <span>↗</span></a><button class="menu-toggle" data-menu-toggle aria-label="Відкрити навігацію" aria-expanded="false">☰</button></div></div></header>`;
}
function shell({
  title,
  body,
  current = "",
  root = "./",
  description = "ARC — application graph framework/compiler для server, browser та fullstack applications.",
}) {
  return `<!doctype html><html lang="uk"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escape(description)}"><meta name="theme-color" content="#10141c"><title>${escape(title)} · ARC</title><link rel="icon" href="${root}assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="${root}assets/style.css"><script src="${root}assets/site.js" defer data-root="${root}"></script></head><body>${header(root, current)}${body}<footer class="footer"><a class="logo" href="${root}index.html">arc<span class="logo-period">.</span></a><p>Application architecture. Made executable.</p><a href="${root}docs/changelog.html">Журнал змін</a></footer><dialog class="search-dialog" aria-labelledby="search-title"><div class="search-top"><h2 id="search-title">Знайти в документації</h2><button data-search-close aria-label="Закрити пошук">×</button></div><input type="search" placeholder="State, operation, remote…" aria-label="Пошуковий запит" autocomplete="off"><div class="search-results" aria-live="polite"><p>Введіть назву або поняття.</p></div><span class="search-hint">Esc — закрити · усе працює без backend</span></dialog></body></html>`;
}
function sidebar(root, current) {
  return `<aside class="docs-sidebar" aria-label="Розділи документації">${navigation.map(([label, links]) => `<section><h2>${label}</h2>${links.map(([url, label]) => `<a href="${root}${url}" ${url === current ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</section>`).join("")}</aside>`;
}
export async function buildSite(outDir = join(siteDir, "dist")) {
  outDir = resolve(outDir);
  if (
    outDir === repo ||
    outDir === siteDir ||
    (!outDir.startsWith(siteDir + "/dist") && !outDir.startsWith("/tmp/"))
  )
    throw Error("Output must be website/dist or a temporary directory");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await cp(join(siteDir, "assets"), join(outDir, "assets"), {
    recursive: true,
  });
  const files = [
    ...(await walk(join(repo, "docs"))).filter((f) => f.endsWith(".md")),
    ...(await walk(join(siteDir, "content"))).filter((f) => f.endsWith(".md")),
    join(repo, "README.md"),
    join(repo, "CHANGELOG.md"),
  ];
  const pages = new Map();
  const sources = new Map();
  for (const file of files) {
    const text = await readFile(file, "utf8");
    pages.set(file, {
      text,
      title: text.match(/^# (.+)$/m)?.[1] ?? "ARC",
      url: route(file),
    });
  }
  function targetLink(target, from, to) {
    if (/^(https?:|mailto:|#)/.test(target)) return target;
    const [path, hash] = target.split("#");
    const file = resolve(dirname(from), path);
    if (!file.startsWith(repo + "/"))
      throw Error(`Link outside repository: ${target}`);
    const dest = route(file);
    if (!pages.has(file)) sources.set(file, dest);
    return (
      relative(dirname(to), dest).replaceAll("\\", "/") +
      (hash ? "#" + hash : "")
    );
  }
  function inline(text, from, to) {
    const held = [];
    const token = (html) => `\u0000${held.push(html) - 1}\u0000`;
    text = text.replace(/`([^`]+)`/g, (_, s) =>
      token(`<code>${escape(s)}</code>`),
    );
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
      token(
        `<a href="${escape(targetLink(url, from, to))}">${escape(label)}</a>`,
      ),
    );
    text = escape(text)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return text.replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)]);
  }
  function markdown(text, from, to) {
    const lines = text.split("\n");
    let html = "",
      toc = [],
      used = new Map();
    for (let i = 0; i < lines.length;) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      if (line.startsWith("```")) {
        const lang = line.slice(3).trim();
        let code = [];
        i++;
        while (i < lines.length && !lines[i].startsWith("```"))
          code.push(lines[i++]);
        i++;
        html += `<div class="code-block"><div class="code-toolbar"><span>${escape(lang || "code")}</span><button data-copy aria-label="Копіювати код">Копіювати</button></div><pre>${highlightCode(code.join("\n"), lang)}</pre></div>`;
        continue;
      }
      const h = line.match(/^(#{1,6})\s+(.+)$/);
      if (h) {
        const level = h[1].length;
        const base = slug(h[2]);
        const count = used.get(base) || 0;
        used.set(base, count + 1);
        const id = base + (count ? "-" + count : "");
        if (level === 2 || level === 3)
          toc.push({ id, text: h[2].replace(/`/g, ""), level });
        html += `<h${level} id="${escape(id)}">${inline(h[2], from, to)}${level > 1 ? `<a class="heading-anchor" href="#${escape(id)}" aria-label="Посилання на розділ">#</a>` : ""}</h${level}>`;
        i++;
        continue;
      }
      if (/^\|/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
        const cells = (s) =>
          s
            .trim()
            .replace(/^\||\|$/g, "")
            .split("|");
        html +=
          '<div class="table-wrap"><table><thead><tr>' +
          cells(line)
            .map((c) => `<th>${inline(c.trim(), from, to)}</th>`)
            .join("") +
          "</tr></thead><tbody>";
        i += 2;
        while (i < lines.length && lines[i].startsWith("|"))
          html +=
            "<tr>" +
            cells(lines[i++])
              .map((c) => `<td>${inline(c.trim(), from, to)}</td>`)
              .join("") +
            "</tr>";
        html += "</tbody></table></div>";
        continue;
      }
      if (/^>/.test(line)) {
        let body = [];
        while (i < lines.length && /^>/.test(lines[i]))
          body.push(lines[i++].replace(/^>\s?/, ""));
        html += `<blockquote>${inline(body.join(" "), from, to)}</blockquote>`;
        continue;
      }
      if (/^\s*(?:[-*]|\d+\.)\s/.test(line)) {
        const ordered = /^\s*\d+\./.test(line);
        const tag = ordered ? "ol" : "ul";
        html += `<${tag}>`;
        while (i < lines.length && /^\s*(?:[-*]|\d+\.)\s/.test(lines[i]))
          html += `<li>${inline(lines[i++].replace(/^\s*(?:[-*]|\d+\.)\s/, ""), from, to)}</li>`;
        html += `</${tag}>`;
        continue;
      }
      let body = [line];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(?:#{1,6} |```|\||>|[-*] |\d+\. )/.test(lines[i])
      )
        body.push(lines[i++]);
      html += `<p>${inline(body.join(" "), from, to)}</p>`;
    }
    return { html, toc };
  }
  const search = [];
  for (const [file, page] of pages) {
    const root = "../".repeat(page.url.split("/").length - 1) || "./";
    const rendered = markdown(page.text, file, page.url);
    const lesson = page.url.startsWith("learn/");
    let pager = "";
    if (lesson) {
      const lessons = navigation.find(([x]) => x === "УРОКИ")[1];
      const idx = lessons.findIndex(([url]) => url === page.url);
      pager = `<nav class="lesson-pager" aria-label="Порядок уроків">${idx > 0 ? `<a href="${root}${lessons[idx - 1][0]}">← ${lessons[idx - 1][1]}</a>` : "<span></span>"}${idx < lessons.length - 1 ? `<a href="${root}${lessons[idx + 1][0]}">${lessons[idx + 1][1]} →</a>` : `<a href="${root}docs/web/index.html">До документації →</a>`}</nav>`;
    }
    const body = `<div class="docs-layout">${sidebar(root, page.url)}<main class="article" id="content"><div class="article-kicker">${lesson ? "ARC / ПОСЛІДОВНИЙ КУРС" : "ARC / ДОКУМЕНТАЦІЯ"}</div>${rendered.html}${pager}<div class="article-note">${lesson ? "Навчальний матеріал ARC" : "Побудовано з " + escape(relative(repo, file)) + " · source of truth — код і contracts"}</div></main><aside class="toc"><h2>НА ЦІЙ СТОРІНЦІ</h2>${rendered.toc.map((h) => `<a class="level-${h.level}" href="#${escape(h.id)}">${escape(h.text)}</a>`).join("")}</aside></div>`;
    await mkdir(dirname(join(outDir, page.url)), { recursive: true });
    await writeFile(
      join(outDir, page.url),
      shell({ title: page.title, body, current: page.url, root }),
    );
    search.push({
      title: page.title,
      url: page.url,
      text: page.text
        .replace(/```[\s\S]*?```/g, "")
        .replace(/[#*`|>]/g, "")
        .slice(0, 14000),
    });
  }
  // Relative source links stay useful even without an external GitHub repository URL.
  for (const [file, url] of sources) {
    const text = await readFile(file, "utf8");
    const root = "../".repeat(url.split("/").length - 1);
    const body = `<main class="source-page article" id="content"><div class="article-kicker">ARC / SOURCE</div><h1>${escape(relative(repo, file))}</h1><p>Файл із репозиторію, включений до статичної збірки.</p><div class="code-block"><div class="code-toolbar"><span>${escape(extname(file).slice(1))}</span><button data-copy>Копіювати</button></div><pre>${highlightCode(text, extname(file).slice(1))}</pre></div></main>`;
    await mkdir(dirname(join(outDir, url)), { recursive: true });
    await writeFile(
      join(outDir, url),
      shell({ title: relative(repo, file), body, root }),
    );
  }
  await writeFile(join(outDir, "search-index.json"), JSON.stringify(search));
  await writeFile(join(outDir, ".nojekyll"), "");
  await writeFile(
    join(outDir, "index.html"),
    shell({
      title: "Один graph. Увесь застосунок.",
      body: (await readFile(join(siteDir, "home.html"), "utf8"))
        .replaceAll("{{version}}", escape(version))
        .replace(
          /<pre><code>([\s\S]*?)<\/code><\/pre>/g,
          (_, html) => {
            const code = html
              .replace(/<[^>]+>/g, "")
              .replace(
                /&(lt|gt|amp|quot|#39);/g,
                (_, entity) =>
                  ({ lt: "<", gt: ">", amp: "&", quot: '"', "#39": "'" })[entity],
              );
            return `<pre>${highlightCode(code, "typescript")}</pre>`;
          },
        ),
    }),
  );
  const cards = navigation.find(([x]) => x === "УРОКИ")[1];
  await mkdir(join(outDir, "learn"), { recursive: true });
  await writeFile(
    join(outDir, "learn/index.html"),
    shell({
      title: "Навчіться ARC крок за кроком",
      root: "../",
      current: "learn/index.html",
      body: `<main class="learn-page" id="content"><div class="section-label">LEARN ARC</div><h1>Від першого запуску<br>до повного graph<span>.</span></h1><p class="lead">П’ять практичних уроків. Server, browser та явний зв’язок між ними — на реальному коді.</p><div class="lesson-list">${cards.map(([url, title], i) => `<a href="../${url}"><span class="lesson-number">0${i + 1}</span><div><h2>${title.slice(5)}</h2><p>${["Запустіть Workspace і знайдіть свій шлях у репозиторії.", "Напишіть contract, dependency та executable scenario.", "Підключіть state до DOM без повторного setup.", "Проведіть явну boundary з browser на server.", "Зіставте architecture з actual runtime activity."][i]}</p></div><span>↗</span></a>`).join("")}</div><p class="muted">Node.js 22.18+ · базові знання TypeScript · local development</p></main>`,
    }),
  );
  return {
    outDir,
    pages: pages.size + sources.size + 2,
    documents: search.length,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(await buildSite());
