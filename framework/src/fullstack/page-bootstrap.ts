import { startWeb } from "../web/runtime.js";
import { layoutView, rootView } from "../neutral/page-root.js";
import { comparePagePaths, matchPagePath, pageParamNames } from "../neutral/page-path.js";
import { pageView, outlet, view as defineView, type View } from "../web/view.js";
import { jsx } from "../web/jsx-runtime.js";
import { signal, type Signal } from "../web/reactive.js";
import { telemetryTransport } from "./client.js";

type PageModule = { default: unknown; title?: string; styles?: string };
type BrowserRoute = {
  load(): Promise<PageModule>;
  id: string;
  path: string;
  layouts: readonly { path: string; module: PageModule }[];
};

type RouteNode = {
  path: string;
  module?: PageModule;
  layouts: Map<string, RouteNode>;
  pages: BrowserRoute[];
  current?: Signal<View>;
  view?: View;
};

export async function bootstrapPages(routes: readonly BrowserRoute[]) {
  const target = document.getElementById("app");
  if (!target) throw new Error("ARC page requires an #app container");
  const initialPath = window.location.pathname;
  const match = (path: string) => routes
    .map((route) => ({ route, params: matchPagePath(route.path, path) }))
    .filter((entry) => entry.params !== undefined)
    .sort((a, b) => comparePagePaths(a.route.path, b.route.path))[0];
  const active = match(initialPath);
  if (!active) throw new Error(`No ARC page matches ${initialPath}`);
  const pageModules = new Map<BrowserRoute, PageModule>();
  const pageLoads = new Map<BrowserRoute, Promise<PageModule>>();
  const loadPage = (route: BrowserRoute) => {
    let load = pageLoads.get(route);
    if (!load) {
      load = route.load().then((module) => {
        pageModules.set(route, module);
        return module;
      });
      pageLoads.set(route, load);
    }
    return load;
  };
  await loadPage(active.route);
  const root: RouteNode = { path: "", layouts: new Map(), pages: [] };
  const pageViews = new Map<string, View>();
  for (const route of routes) {
    let parent = root;
    for (const { path, module } of route.layouts) {
      let node = parent.layouts.get(path);
      if (!node) {
        node = { path, module, layouts: new Map(), pages: [] };
        parent.layouts.set(path, node);
      }
      parent = node;
    }
    parent.pages.push(route);
  }

  const makePage = (route: BrowserRoute, pathname: string, module: PageModule) => {
    const key = `${route.path}\n${pathname}`;
    const cached = pageViews.get(key);
    if (cached) return cached;
    const params = matchPagePath(route.path, pathname) ?? Object.fromEntries(
      pageParamNames(route.path).map((name) => [name, ""]),
    );
    const page = rootView(module.default, route.id, pageView, params);
    pageViews.set(key, page);
    return page;
  };
  const emptyView = defineView({
    id: "router:empty",
    template: () => jsx("div", { style: "display:contents" }),
  });
  const makeNode = (node: RouteNode): View => {
    const choices = [
      emptyView,
      ...[...node.layouts.values()].map(makeNode),
      ...node.pages.filter((route) => pageModules.has(route)).map((route) => makePage(
        route,
        route === active.route ? initialPath : route.path.replace(/:([\w]+)/g, ""),
        pageModules.get(route)!,
      )),
    ];
    const current = signal<View>({
      id: node.path ? `router:${node.path}` : "router:root",
      initial: choose(node, active.route) ?? choices[0]!,
      scope: "application",
    });
    node.current = current;
    const outletView = outlet(node.path ? `router-outlet:${node.path}` : "router-outlet:root", current, choices);
    const firstRoute = node.path
      ? routes.find((route) => route.layouts.some((layout) => layout.path === node.path))
      : undefined;
    const layoutIndex = firstRoute?.layouts.findIndex((layout) => layout.path === node.path) ?? -1;
    node.view = node.module
      ? layoutView(
          node.module.default,
          outletView,
          node.path,
          pageView,
          matchPagePath(node.path, initialPath) ?? Object.fromEntries(pageParamNames(node.path).map((name) => [name, ""])),
          layoutIndex === 0 ? `layout:${firstRoute!.path}` : `layout:${firstRoute!.path}:${node.path}`,
        )
      : outletView;
    return node.view;
  };
  function choose(node: RouteNode, route: BrowserRoute): View | undefined {
    const nextLayout = route.layouts.find(({ path }) => !node.path || (
      path !== node.path && (node.path === "/" ? path.startsWith("/") : path.startsWith(`${node.path}/`))
    ));
    if (nextLayout) return node.layouts.get(nextLayout.path)?.view;
    if (!node.path || route.layouts.some(({ path }) => path === node.path))
      return node.pages.includes(route) ? makePage(route, initialPath, pageModules.get(route)!) : undefined;
    return undefined;
  }

  // Build descendants first so each outlet has its declared view choices.
  makeNode(root);
  const layoutModules = new Map<string, PageModule>();
  for (const route of routes) for (const layout of route.layouts) layoutModules.set(layout.path, layout.module);
  const telemetry = telemetryTransport();
  let style: HTMLStyleElement | undefined;
  const updateCurrentLinks = (pathname: string) => {
    for (const anchor of target.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      let current = false;
      try {
        const url = new URL(anchor.href, window.location.href);
        current = url.origin === window.location.origin && (
          url.pathname === pathname || (url.pathname !== "/" && pathname.startsWith(`${url.pathname}/`))
        );
      } catch { /* Ignore non-URL anchors. */ }
      anchor.classList.toggle("active", current);
      if (current) anchor.setAttribute("aria-current", "page");
      else anchor.removeAttribute("aria-current");
    }
  };
  let navigation = 0;
  const applyRoute = async (pathname: string) => {
    const found = match(pathname);
    if (!found) return false;
    const currentNavigation = ++navigation;
    const page = await loadPage(found.route);
    if (currentNavigation !== navigation || pathname !== window.location.pathname) return true;
    const pageViewForRoute = (route: BrowserRoute) => makePage(route, pathname, page);
    let node = root;
    const chain = found.route.layouts;
    for (const layout of chain) {
      const child = node.layouts.get(layout.path);
      if (!child) break;
      node.current!.set(child.view!);
      node = child;
    }
    node.current!.set(pageViewForRoute(found.route));
    const activeLayouts = chain.map(({ path }) => layoutModules.get(path)!).filter(Boolean);
    const title = page.title ?? [...activeLayouts].reverse().find((layout) => layout.title)?.title;
    if (title) document.title = title;
    const styles = [...activeLayouts.map((layout) => layout.styles), page.styles].filter(Boolean).join("\n");
    if (styles) {
      if (!style) {
        style = document.createElement("style");
        document.head.append(style);
      }
      style.textContent = styles;
    } else {
      style?.remove();
      style = undefined;
    }
    updateCurrentLinks(pathname);
    return true;
  };
  await applyRoute(initialPath);
  const app = startWeb(root.view!, target, { telemetry });
  updateCurrentLinks(initialPath);
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null | undefined;
    if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
    let url: URL;
    try { url = new URL(anchor.href, window.location.href); } catch { return; }
    if (url.origin !== window.location.origin) return;
    const changedPath = url.pathname !== window.location.pathname;
    if (changedPath && !match(url.pathname)) return;
    event.preventDefault();
    window.history.pushState({}, "", url.href);
    if (changedPath) void applyRoute(url.pathname).catch(() => window.location.assign(url.href));
    if (url.hash) {
      const id = decodeURIComponent(url.hash.slice(1));
      setTimeout(() => target.ownerDocument.getElementById(id)?.scrollIntoView?.(), 0);
    } else if (changedPath) {
      window.scrollTo?.(0, 0);
    }
  };
  const popstate = () => {
    void applyRoute(window.location.pathname).then((matched) => {
      if (!matched || !window.location.hash) return;
      const id = decodeURIComponent(window.location.hash.slice(1));
      setTimeout(() => target.ownerDocument.getElementById(id)?.scrollIntoView?.(), 0);
    }).catch(() => window.location.reload());
  };
  target.addEventListener("click", click);
  window.addEventListener("popstate", popstate);
  window.addEventListener("pagehide", () => {
    target.removeEventListener("click", click);
    window.removeEventListener("popstate", popstate);
    try { app.dispose(); } finally {
      style?.remove();
      void telemetry.dispose();
    }
  }, { once: true });
}

export function bootstrapPage(
  page: PageModule,
  id: string,
  path: string,
  layouts: readonly PageModule[] = [],
) {
  const target = document.getElementById("app");
  if (!target) throw new Error("ARC page requires an #app container");

  const title = page.title ?? [...layouts].reverse().find((layout) => layout.title)?.title;
  if (title) document.title = title;
  const styles = [...layouts.map((layout) => layout.styles), page.styles].filter(Boolean).join("\n");
  const style = styles ? document.createElement("style") : undefined;
  if (style) {
    style.textContent = styles;
    document.head.append(style);
  }
  const telemetry = telemetryTransport();
  try {
    const params = pageParamNames(path).length ? matchPagePath(path, window.location.pathname) : {};
    if (!params) throw new Error(`URL does not match ARC page ${path}`);
    const pageRoot = rootView(page.default, id, pageView, params);
    const root = layouts.reduceRight((child, layout, index) => layoutView(
      layout.default, child, path, pageView, params,
      index === 0 ? `layout:${path}` : `layout:${path}:${index}`,
    ), pageRoot);
    const app = startWeb(root, target, { telemetry });
    window.addEventListener("pagehide", () => {
      try {
        app.dispose();
      } finally {
        style?.remove();
        void telemetry.dispose();
      }
    }, { once: true });
  } catch (error) {
    style?.remove();
    void telemetry.dispose();
    throw error;
  }
}
