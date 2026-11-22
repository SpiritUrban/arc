import { compileReactiveJsx } from "./reactive-jsx.js";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { wireContract } from "../neutral/descriptor.js";
import { comparePagePaths, matchPagePath } from "../neutral/page-path.js";
import type { ArchitectureIR, GraphDefinition } from "../neutral/graph.js";
import { fileURLToPath } from "node:url";
type BuildLayout = { path: string; entry: string };
type BuildPage = { path: string; entry: string; id?: string; layouts?: readonly BuildLayout[] };
export type PageAssets = { path: string; html: string; script: string; api?: boolean };

export interface BuildHost {
  graph(): ArchitectureIR;
  webConfig(): {
    entry?: string;
    nodes: GraphDefinition[];
    serverModules?: string[];
    bootstrap?: { id: string };
    pages?: readonly BuildPage[];
    layout?: string;
    layouts?: Readonly<Record<string, string>>;
  } | undefined;
}

function pageAssets(path: string): PageAssets {
  if (path === "/") return { path, html: "index.html", script: "/app.js" };
  const id = createHash("sha256").update(path).digest("hex").slice(0, 20);
  return { path, html: `arc-page-${id}.html`, script: `/arc-page-${id}.js` };
}

function hasReadRoute(path: string, ir: ArchitectureIR) {
  const segments = path.replace(/\/$/, "").split("/");
  return ir.routes.some((route) => {
    if (route.method !== "GET" && route.method !== "HEAD") return false;
    const parts = route.path.replace(/\/$/, "").split("/");
    return parts.length === segments.length && parts.every(
      (part, index) => part === segments[index] || (part.startsWith(":") && segments[index]) || (segments[index].startsWith(":") && part),
    );
  });
}

async function buildPage(
  { entry: source, id, path }: BuildPage,
  outfile: string,
  ir: ArchitectureIR,
  serverModules: Set<string>,
  reactiveEntries: ReadonlySet<string>,
  layouts: readonly BuildLayout[] = [],
  routerRoutes?: readonly BuildPage[],
) {
  const entry = resolve(source);
  const browserCore = fileURLToPath(
    new URL("../core-entry.js", import.meta.url),
  );
  const routerInput = routerRoutes ? (() => {
    const layoutAliases = new Map<string, string>();
    for (const route of routerRoutes) for (const layout of route.layouts ?? [])
      if (!layoutAliases.has(layout.path)) layoutAliases.set(layout.path, `layout${layoutAliases.size}`);
    return {
      stdin: {
        contents: [
          ...routerRoutes.map((route, index) => `import * as page${index} from ${JSON.stringify(resolve(route.entry))};`),
          ...[...layoutAliases].map(([path, alias]) => {
            const entry = routerRoutes.flatMap((route) => route.layouts ?? []).find((layout) => layout.path === path)!.entry;
            return `import * as ${alias} from ${JSON.stringify(resolve(entry))};`;
          }),
          `import { bootstrapPages } from ${JSON.stringify(fileURLToPath(new URL("./page-bootstrap.js", import.meta.url)))};`,
          `bootstrapPages([${routerRoutes.map((route, index) => `{page:page${index},id:${JSON.stringify(route.id)},path:${JSON.stringify(route.path)},layouts:[${(route.layouts ?? []).map((layout) => `{path:${JSON.stringify(layout.path)},module:${layoutAliases.get(layout.path)}}`).join(",")}]}`).join(",")}]);`,
        ].join("\n"),
        resolveDir: dirname(resolve(routerRoutes[0]!.entry)),
        sourcefile: "arc-router-entry.js",
      },
    };
  })() : undefined;
  const input = routerInput ?? (id
    ? {
        stdin: {
          contents: [
            `import * as page from ${JSON.stringify(entry)};`,
            ...layouts.map((layout, index) => `import * as layout${index} from ${JSON.stringify(resolve(layout.entry))};`),
            `import { bootstrapPage } from ${JSON.stringify(fileURLToPath(new URL("./page-bootstrap.js", import.meta.url)))};`,
            `bootstrapPage(page, ${JSON.stringify(id)}, ${JSON.stringify(path)}${layouts.length ? `, [${layouts.map((_, index) => `layout${index}`).join(", ")}]` : ""});`,
          ].join("\n"),
          resolveDir: dirname(entry),
          sourcefile: "arc-page-entry.js",
        },
      }
      : { entryPoints: [entry] });
  const result = await build({
    ...input,
    ...(id || routerRoutes ? {
      jsx: "automatic" as const,
      jsxImportSource: "@arc/framework/web",
    } : {}),
    outfile,
    bundle: true,
    platform: "browser",
    conditions: ["arc-source", "browser"],
    format: "esm",
    target: "es2022",
    logLevel: "silent",
    metafile: true,
    write: true,
    plugins: [
      {
        name: "arc-runtime-boundaries",
        setup(builder) {
          builder.onResolve({ filter: /^node:/ }, (args) => ({
            errors: [
              {
                text: `ARC201 Node builtin in browser graph: ${args.path} imported by ${args.importer}`,
              },
            ],
          }));
          builder.onLoad({ filter: /\.tsx$/ }, async (args) => {
            const reactive = reactiveEntries.has(args.path) ||
              !args.path.replaceAll("\\", "/").includes("/node_modules/");
            const contents = compileReactiveJsx(await readFile(args.path, "utf8"), args.path, {
              reactive,
            });
            if (contents !== undefined) return { contents, loader: "js", resolveDir: dirname(args.path) };
          });
          builder.onLoad({ filter: /\.[cm]?[jt]s$/ }, async (args) => {
            if (!serverModules.has(args.path)) return;
            const exports = await import(pathToFileURL(args.path).href);
            const statements = [
              `import {descriptor} from ${JSON.stringify(browserCore)};`,
            ];
            for (const [name, value] of Object.entries(exports) as [
              string,
              any,
            ][]) {
              if (value?.kind !== "operation")
                throw new Error(
                  `ARC201 server module exports non-operation ${name}; move contracts into shared modules`,
                );
              const declared = ir.nodes.find(
                (n) => n.id === value.id && n.kind === "operation",
              );
              if (!declared || !value.expose?.web)
                throw new Error(
                  `ARC-WEB-206 build exposure denied: ${value.id}`,
                );
              statements.push(
                `export const ${name}=descriptor(${JSON.stringify(wireContract(value))});`,
              );
            }
            return {
              contents: statements.join("\n"),
              loader: "js",
              resolveDir: dirname(args.path),
            };
          });
        },
      },
    ],
  });
  const inputs = Object.keys(result.metafile!.inputs);
  const forbidden = inputs.filter((path) =>
    /framework\/(?:src|dist)\/(?:core\.[jt]s|http\.[jt]s|server\.[jt]s|runtime-adapters\.[jt]s|fullstack\/server\.[jt]s)/.test(
      path.replaceAll("\\", "/"),
    ),
  );
  if (forbidden.length)
    throw new Error(
      `ARC201 server implementation reached browser bundle: ${forbidden.join(", ")}`,
    );
  return { inputs, bytes: Object.values(result.metafile!.outputs)[0]?.bytes ?? 0 };
}

export async function buildWeb(app: BuildHost, options: { outDir?: string } = {}) {
  const config = app.webConfig();
  if (!config?.entry) throw new Error("Declare a web page or web.entry for browser compilation");

  const ir = app.graph();
  const outDir = resolve(options.outDir ?? ".arc/web");
  await mkdir(outDir, { recursive: true });
  const declaredRoutes = config.pages ?? [{ path: "/", entry: config.entry, id: config.bootstrap?.id }];
  const pages = declaredRoutes.map(({ path }) => ({
    ...pageAssets(path),
    ...(config.pages ? { script: "/app.js" } : {}),
    api: Boolean(config.pages) && hasReadRoute(path, ir),
  }));
  const serverModules = new Set((config.serverModules ?? []).map((file) => resolve(file)));
  const reactiveEntries = new Set(declaredRoutes.filter(({ id }) => id).map(({ entry }) => resolve(entry)));
  const layouts = new Map<string, string>();
  if (config.layout) layouts.set("/", config.layout);
  for (const [path, file] of Object.entries(config.layouts ?? {})) layouts.set(path, file);
  const routes = declaredRoutes.map((route) => {
    const applicable = [...layouts].filter(([base]) => base === "/" || route.path === base || route.path.startsWith(`${base}/`))
      .sort(([a], [b]) => a.length - b.length).map(([path, file]) => ({ path, entry: resolve(file) }));
    return { ...route, layouts: applicable };
  });
  for (const layout of layouts.values()) reactiveEntries.add(resolve(layout));
  const writeHtml = async (page: PageAssets) => {
    const { html, script } = page;
    await writeFile(join(outDir, html),
      `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARC Application</title></head><body><div id="app"></div><script type="module" src="${script}"></script></body></html>`,
    );
  };
  let builds;
  if (config.pages) {
    const result = await buildPage(routes[0]!, join(outDir, "app.js"), ir, serverModules, reactiveEntries, [], routes);
    builds = [result];
    await Promise.all(pages.map(writeHtml));
  } else {
    builds = await Promise.all(routes.map(async (route, index) => {
      const page = pages[index]!;
      const result = await buildPage(route, join(outDir, page.script.slice(1)), ir, serverModules, reactiveEntries, route.layouts);
      await writeHtml(page);
      return result;
    }));
  }
  const manifest = {
    version: 3,
    entry: config.entry,
    partitions: ir.partitions,
    boundaries: ir.boundaries,
    inputs: [...new Set(builds.flatMap((result) => result.inputs))],
    serverModules: [...serverModules],
    browserBytes: builds.reduce((sum, result) => sum + result.bytes, 0),
    ...(config.pages ? { pages } : {}),
  };
  await Promise.all([
    writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2)),
    writeFile(join(outDir, "architecture.json"), JSON.stringify(ir, null, 2)),
    writeFile(join(outDir, "pages.json"), JSON.stringify(pages)),
  ]);
  return { outDir, manifest, pages };
}

function missingFile(error: unknown) {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

export function findWebPage(pages: readonly PageAssets[], pathname: string) {
  return pages.filter(({ path }) => matchPagePath(path, pathname) !== undefined)
    .sort((a, b) => comparePagePaths(a.path, b.path))[0];
}

export async function staticWeb(
  outDir: string,
  request: Request,
  builtPages?: readonly PageAssets[],
): Promise<Response | undefined> {
  if (request.method !== "GET" && request.method !== "HEAD") return;
  const path = new URL(request.url).pathname;
  if (path === "/openapi.json") return;
  let pages = builtPages;
  if (!pages) {
    try {
      pages = JSON.parse(await readFile(join(outDir, "pages.json"), "utf8")) as PageAssets[];
    } catch (error) {
      if (!missingFile(error)) throw error;
      pages = [pageAssets("/")];
    }
  }
  const acceptsHtml = (request.headers.get("accept") ?? "").split(",").some((entry) => {
    const [type, ...params] = entry.toLowerCase().split(";").map((part) => part.trim());
    return (type === "text/html" || type === "application/xhtml+xml") &&
      !params.some((param) => /^q\s*=\s*0(?:\.0*)?$/.test(param));
  });
  const script = pages.find((page) => page.script === path);
  const page = findWebPage(pages, path);
  const file = script ? script.script.slice(1) : page && (!page.api || acceptsHtml) ? page.html : undefined;
  if (!file) return;

  try {
    const contents = await readFile(join(outDir, file));
    return new Response(request.method === "HEAD" ? null : contents, {
      headers: script
        ? { "content-type": "text/javascript; charset=utf-8" }
        : { "content-type": "text/html; charset=utf-8", ...(page?.api ? { vary: "Accept" } : {}) },
    });
  } catch (error) {
    if (!missingFile(error)) throw error;
  }
}
