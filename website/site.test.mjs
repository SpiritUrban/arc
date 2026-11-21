import { highlightCode } from "./highlight.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { buildSite, escape } from "./build.mjs";
async function files(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : join(dir, e.name),
      ),
    )
  ).flat();
}
test("static website resolves all local assets, routes and anchors under root and GitHub project prefix", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arc-site-"));
  try {
    const result = await buildSite(dir);
    assert.ok(result.documents >= 30);
    for (const path of [
      "index.html",
      "learn/03-reactive-view.html",
      "source/examples/workspace/browser.ts.html",
    ]) {
      const { document } = parseHTML(await readFile(join(dir, path), "utf8"));
      assert.ok(
        document.querySelector("pre code.hljs .hljs-keyword"),
        `missing highlighting: ${path}`,
      );
    }
    const paths = await files(dir);
    const cache = new Map();
    for (const path of paths.filter((f) => f.endsWith(".html")))
      cache.set(path, parseHTML(await readFile(path, "utf8")).document);
    for (const [file, document] of cache) {
      assert.ok(document.querySelector("title")?.textContent.includes("ARC"));
      assert.equal(document.documentElement.lang, "uk");
      for (const element of document.querySelectorAll("[href],[src]")) {
        const link =
          element.getAttribute("href") ?? element.getAttribute("src");
        if (/^(https?:|mailto:)/.test(link)) continue;
        assert.ok(
          !link.startsWith("/"),
          `${file}: root-absolute URL breaks project Pages: ${link}`,
        );
        const url = new URL(
          link,
          "https://example.github.io/arc/" + file.slice(dir.length + 1),
        );
        assert.ok(
          url.pathname.startsWith("/arc/"),
          `escaped Pages prefix: ${link}`,
        );
        const target = resolve(
          dir,
          decodeURIComponent(url.pathname.slice("/arc/".length)),
        );
        assert.ok(paths.includes(target), `${file}: broken ${link}`);
        if (url.hash && cache.has(target)) {
          const id = decodeURIComponent(url.hash.slice(1));
          assert.ok(
            cache.get(target).getElementById(id),
            `${file}: missing anchor ${link}`,
          );
        }
      }
    }
    assert.ok(
      cache
        .get(join(dir, "index.html"))
        .querySelector(".hero a.primary")
        .getAttribute("href")
        .includes("getting-started"),
    );
    const search = JSON.parse(
      await readFile(join(dir, "search-index.json"), "utf8"),
    );
    assert.ok(search.some((p) => p.url === "docs/web/writing-frontend.html"));
    assert.equal(search.filter((p) => p.url.startsWith("learn/")).length, 5);
    assert.equal(escape("<script>"), "&lt;script&gt;");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("browser client tabs, navigation, search and copy operate without application backend", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arc-site-client-"));
  try {
    await buildSite(dir);
    const { document, window } = parseHTML(
      await readFile(join(dir, "index.html"), "utf8"),
    );
    const script = document.querySelector("script");
    Object.defineProperty(document, "currentScript", { value: script });
    const dialog = document.querySelector("dialog");
    dialog.showModal = () => dialog.setAttribute("open", "");
    dialog.close = () => dialog.removeAttribute("open");
    let copied = "",
      fetchPath = "";
    const index = JSON.parse(
      await readFile(join(dir, "search-index.json"), "utf8"),
    );
    const context = vm.createContext({
      document,
      localStorage: {
        getItem() {
          return null;
        },
        setItem() {},
      },
      navigator: {
        clipboard: {
          async writeText(value) {
            copied = value;
          },
        },
      },
      setTimeout: () => 0,
      fetch: async (path) => {
        fetchPath = path;
        return { ok: true, json: async () => index };
      },
    });
    new vm.Script(
      await readFile(join(dir, "assets/site.js"), "utf8"),
    ).runInContext(context);
    document
      .querySelector("[data-tab=web]")
      .dispatchEvent(new window.Event("click"));
    assert.equal(document.getElementById("demo-web").hidden, false);
    assert.equal(document.getElementById("demo-server").hidden, true);
    document
      .querySelector("[data-menu-toggle]")
      .dispatchEvent(new window.Event("click"));
    assert.ok(document.body.classList.contains("menu-open"));
    document
      .querySelector("[data-search-open]")
      .dispatchEvent(new window.Event("click"));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(fetchPath, "./search-index.json");
    assert.ok(dialog.hasAttribute("open"));
    const input = dialog.querySelector("input");
    input.value = "State";
    input.dispatchEvent(new window.Event("input"));
    assert.ok(dialog.querySelectorAll(".search-results a").length > 0);
    input.value = "gibberish-no-match-9283";
    input.dispatchEvent(new window.Event("input"));
    assert.match(dialog.querySelector(".search-results").textContent, /Нічого/);
    document
      .querySelector(".install-command [data-copy]")
      .dispatchEvent(new window.Event("click"));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(copied, "npm run dev:workspace");
    document
      .querySelector("[data-theme-toggle]")
      .dispatchEvent(new window.Event("click"));
    assert.equal(document.documentElement.dataset.theme, "light");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("syntax highlighting supports aliases, preserves code and escapes markup", () => {
  const samples = [
    ["ts", 'const title: string = "<script>alert(1)</script>"; // comment'],
    ["js", "function add(n) { return n + 1; }"],
    ["json", '{"active": true, "count": 2}'],
    ["sh", "npm run build # compile"],
    ["html", "<button disabled>Hi</button>"],
    ["css", ".demo { color: red; }"],
    ["yaml", "enabled: true"],
    ["text", "<img src=x onerror=alert(1)>"],
    ["unknown-language", "a < b && b > c"],
  ];
  for (const [language, code] of samples) {
    const { document } = parseHTML(highlightCode(code, language));
    assert.equal(document.querySelector("code").textContent, code);
    assert.equal(document.querySelector("script,img,button"), null);
    assert.equal(
      Boolean(document.querySelector(".hljs")),
      !["text", "unknown-language"].includes(language),
    );
  }
});
