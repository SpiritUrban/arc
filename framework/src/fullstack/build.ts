import { build } from "esbuild";
import { resolve, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { wireContract } from "../neutral/descriptor.js";
import type { ArchitectureIR, GraphDefinition } from "../neutral/graph.js";
import { fileURLToPath } from "node:url";
export interface BuildHost {
  graph(): ArchitectureIR;
  webConfig():
    | { entry?: string; nodes: GraphDefinition[]; serverModules?: string[] }
    | undefined;
}
export async function buildWeb(
  app: BuildHost,
  options: { outDir?: string } = {},
) {
  const config = app.webConfig();
  if (!config?.entry)
    throw new Error("Declare web.entry for browser compilation");
  const ir = app.graph(),
    entry = resolve(config.entry),
    outDir = resolve(options.outDir ?? ".arc/web");
  await mkdir(outDir, { recursive: true });
  const serverModules = new Set(
    (config.serverModules ?? []).map((file) => resolve(file)),
  );
  const browserCore = fileURLToPath(
    new URL("../core-entry.js", import.meta.url),
  );
  const result = await build({
    entryPoints: [entry],
    outfile: join(outDir, "app.js"),
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
  const manifest = {
    version: 3,
    entry: config.entry,
    partitions: ir.partitions,
    boundaries: ir.boundaries,
    inputs,
    serverModules: [...serverModules],
    browserBytes:
      result.metafile!.outputs[join(outDir, "app.js")]?.bytes ??
      Object.values(result.metafile!.outputs)[0]?.bytes,
  };
  await writeFile(
    join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  await writeFile(
    join(outDir, "architecture.json"),
    JSON.stringify(ir, null, 2),
  );
  await writeFile(
    join(outDir, "index.html"),
    '<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARC Application</title><div id="app"></div><script type="module" src="/app.js"></script></html>',
  );
  return { outDir, manifest };
}
export async function staticWeb(
  outDir: string,
  request: Request,
): Promise<Response | undefined> {
  const path = new URL(request.url).pathname;
  const file =
    path === "/" ? "index.html" : path === "/app.js" ? "app.js" : undefined;
  if (!file) return;
  return new Response(await readFile(join(outDir, file)), {
    headers: {
      "content-type": file.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : "text/html; charset=utf-8",
    },
  });
}
