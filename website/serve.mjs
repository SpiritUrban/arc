import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { buildSite } from "./build.mjs";
const { outDir } = await buildSite();
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};
const port = Number(process.env.SITE_PORT || 4400);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const path = decodeURIComponent(url.pathname);
    if (path.includes("\0")) throw Error();
    let file = resolve(outDir, "." + path);
    if (file !== outDir && !file.startsWith(outDir + sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": mime[extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Сторінку не знайдено");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`ARC documentation website: http://localhost:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => server.close());
