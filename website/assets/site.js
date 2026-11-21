(() => {
  const root = document.currentScript.dataset.root;
  const dialog = document.querySelector(".search-dialog");
  const input = dialog.querySelector("input");
  const results = dialog.querySelector(".search-results");
  let index;
  try {
    const theme = localStorage.getItem("arc-site-theme");
    if (theme) document.documentElement.dataset.theme = theme;
  } catch {}
  document
    .querySelector("[data-theme-toggle]")
    .addEventListener("click", () => {
      const theme =
        document.documentElement.dataset.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = theme;
      try {
        localStorage.setItem("arc-site-theme", theme);
      } catch {}
    });
  const openSearch = async () => {
    dialog.showModal();
    input.focus();
    if (!index) {
      try {
        const response = await fetch(root + "search-index.json");
        if (!response.ok) throw Error();
        index = await response.json();
        render();
      } catch {
        results.innerHTML =
          "<p>Не вдалося завантажити пошук. Спробуйте ще раз.</p>";
      }
    }
  };
  document
    .querySelector("[data-search-open]")
    .addEventListener("click", openSearch);
  document
    .querySelector("[data-search-close]")
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "/" &&
      !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)
    ) {
      event.preventDefault();
      if (!dialog.open) void openSearch();
    }
  });
  function render() {
    const query = input.value.toLocaleLowerCase().trim();
    results.replaceChildren();
    if (!query) {
      const p = document.createElement("p");
      p.textContent = "Введіть назву або поняття.";
      results.append(p);
      return;
    }
    if (!index) return;
    const words = query.split(/\s+/);
    const matches = index
      .filter((page) =>
        words.every((word) =>
          (page.title + " " + page.text).toLocaleLowerCase().includes(word),
        ),
      )
      .sort(
        (a, b) =>
          Number(b.title.toLocaleLowerCase().includes(query)) -
          Number(a.title.toLocaleLowerCase().includes(query)),
      )
      .slice(0, 12);
    for (const page of matches) {
      const link = document.createElement("a");
      link.href = root + page.url;
      const title = document.createElement("strong");
      title.textContent = page.title;
      const excerpt = document.createElement("span");
      const start = Math.max(0, page.text.toLowerCase().indexOf(words[0]) - 45);
      excerpt.textContent = page.text.slice(start, start + 150) + "…";
      link.append(title, excerpt);
      results.append(link);
    }
    if (!matches.length) {
      const p = document.createElement("p");
      p.textContent = "Нічого не знайдено. Спробуйте інший запит.";
      results.append(p);
    }
  }
  input.addEventListener("input", render);
  document
    .querySelector("[data-menu-toggle]")
    .addEventListener("click", (event) => {
      const expanded = document.body.classList.toggle("menu-open");
      event.currentTarget.setAttribute("aria-expanded", String(expanded));
    });
  document.querySelectorAll("[data-copy]").forEach((button) =>
    button.addEventListener("click", async () => {
      const region = button.closest(".code-block,.demo-panel,.install-command");
      const code = region?.querySelector("code")?.textContent;
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        const original = button.textContent;
        button.textContent = "Скопійовано";
        setTimeout(() => (button.textContent = original), 1800);
      } catch {
        button.textContent = "Виділіть код вручну";
      }
    }),
  );
  const tabs = [...document.querySelectorAll("[data-tab]")];
  function activate(tab) {
    tabs.forEach((item) => {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById("demo-" + item.dataset.tab).hidden = !selected;
    });
  }
  tabs.forEach((tab, i) => {
    tab.tabIndex = i ? -1 : 0;
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (e) => {
      let next;
      if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
      if (e.key === "ArrowLeft")
        next = tabs[(i + tabs.length - 1) % tabs.length];
      if (next) {
        e.preventDefault();
        activate(next);
        next.focus();
      }
    });
  });
})();
