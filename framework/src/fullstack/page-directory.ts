import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function routeSegment(segment: string) {
  const parameter = /^\[([a-zA-Z_][a-zA-Z0-9_]*)\]$/.exec(segment);
  if (parameter) return `:${parameter[1]}`;
  if (segment.includes("[") || segment.includes("]"))
    throw new Error(`Invalid page segment: ${segment}`);
  return encodeURIComponent(segment);
}

export async function discoverPageDirectory(url: URL) {
  const directory = fileURLToPath(url);
  const info = await stat(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (!info?.isDirectory()) return;

  const pages = new Map<string, string>();
  let layout: string | undefined;
  async function visit(folder: string, segments: readonly string[]) {
    const entries = await readdir(folder, { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const filename = join(folder, entry.name);
      if (entry.isDirectory()) {
        await visit(filename, [...segments, routeSegment(entry.name)]);
        continue;
      }
      if (!entry.isFile() || !/\.(tsx|js)$/.test(entry.name)) continue;
      const name = entry.name.replace(/\.(tsx|js)$/, "");
      const source = pathToFileURL(filename).href;
      if (!segments.length && name === "layout") {
        if (layout) throw new Error(`Duplicate layout in ${directory}`);
        layout = source;
        continue;
      }
      const parts = name === "index" ? segments : [...segments, routeSegment(name)];
      const route = `/${parts.join("/")}`;
      if (pages.has(route)) throw new Error(`Duplicate web page path: ${route}`);
      pages.set(route, source);
    }
  }
  await visit(directory, []);
  return { pages: Object.fromEntries(pages), layout };
}
