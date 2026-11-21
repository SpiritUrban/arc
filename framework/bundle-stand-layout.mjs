import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const dagre = import.meta.resolve("@dagrejs/dagre");
const graphlib = pathToFileURL(
  createRequire(dagre).resolve("@dagrejs/graphlib"),
);
const licenses = await Promise.all(
  [dagre, graphlib].map((entry) =>
    readFile(new URL("../LICENSE", entry), "utf8"),
  ),
);

await build({
  entryPoints: ["src/stand-layout.ts"],
  outfile: "dist/stand-layout.js",
  bundle: true,
  platform: "node",
  format: "esm",
  sourcemap: true,
  banner: { js: "/*!\n" + licenses.join("\n") + "\n*/" },
});
