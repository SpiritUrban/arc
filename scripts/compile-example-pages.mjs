import { readFile, readdir, writeFile } from "node:fs/promises";
import { compileReactiveJsx } from "../framework/dist/fullstack/reactive-jsx.js";

const examples = new URL("../examples/", import.meta.url);
const output = new URL("../dist/examples/", import.meta.url);
const pageEntries = new Set([
  "fullstack-tasks/page.tsx",
  "workspace/page.tsx",
  "workspace/orders-screen.tsx",
  "workspace/order-detail.tsx",
]);
for (const file of await readdir(examples, { recursive: true })) {
  if (!file.endsWith(".tsx")) continue;
  const source = await readFile(new URL(file, examples), "utf8");
  const compiled = compileReactiveJsx(source, file, { rewriteImports: true, reactive: pageEntries.has(file) });
  if (compiled !== undefined)
    await writeFile(new URL(file.replace(/\.tsx$/, ".js"), output), compiled);
}
