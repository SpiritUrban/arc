import { cp, mkdtemp, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const root = resolve("."),
  temp = await mkdtemp(join(tmpdir(), "arc-package-"));
try {
  const packed = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        "--workspace",
        "@arc/framework",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        temp,
      ],
      { cwd: root, encoding: "utf8" },
    ),
  );
  await writeFile(
    join(temp, "package.json"),
    '{"type":"module","private":true}',
  );
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      "--cache",
      join(temp, "cache"),
      join(temp, packed[0].filename),
    ],
    { cwd: temp, stdio: "pipe" },
  );
  await writeFile(
    join(temp, "app.mjs"),
    `import {application,resource,operation,s,ok} from '@arc/framework';
const db=resource({id:'offline-db',open(){throw Error('must not activate during graph')}});
export default application({operations:[operation({id:'ping',input:s.object({}),output:s.string(),needs:{db},run:()=>ok('pong')})]});`,
  );
  const graph = JSON.parse(
    execFileSync(
      process.execPath,
      ["node_modules/@arc/framework/arc.mjs", "graph"],
      {
        cwd: temp,
        encoding: "utf8",
        env: { ...process.env, ARC_APP: "app.mjs", NODE_OPTIONS: "" },
      },
    ),
  );
  assert.equal(graph.version, 3);
  assert.ok(graph.nodes.some((n) => n.id === "offline-db"));
  await writeFile(
    join(temp, "check.mjs"),
    `import {state} from '@arc/framework/web';import {remoteCall} from '@arc/framework/fullstack';import {compileArchitecture} from '@arc/framework/core';const local=state({id:'consumer.local',initial:1});if(compileArchitecture([local]).version!==3||typeof remoteCall!=='function')throw Error('subpath failure');local.dispose();import {application,operation,s,ok} from '@arc/framework';const app=application({operations:[operation({id:'ping',input:s.object({}),output:s.string(),run:()=>ok('pong')})]});await app.compile();await app.start();console.log(JSON.stringify(await app.execute('ping',{})));await app.close();`,
  );
  const output = execFileSync(process.execPath, ["check.mjs"], {
    cwd: temp,
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  assert.deepEqual(JSON.parse(output), { ok: true, value: "pong" });
  await writeFile(
    join(temp, "consumer.ts"),
    `import {operation,s,ok} from '@arc/framework';
operation({id:'typed',input:s.object({n:s.int()}),output:s.int(),errors:{MISSING:{status:404,details:s.object({id:s.uuid()})}},run({input,fail}){if(input.n===0)return fail('MISSING',{id:'00000000-0000-4000-8000-000000000001'});return ok(input.n)}});`,
  );
  await writeFile(
    join(temp, "consumer-view.tsx"),
    `import {binding,state,view} from '@arc/framework/web';
const name=state({id:'consumer.name',initial:'ARC'});
const label=binding({id:'consumer.label',type:'text',sources:[name]});
function Heading({title}: {title: string}) { return <h1>{title}</h1>; }
export default view({id:'consumer.page',bindings:[label],template:()=>(
  <main><><Heading title="Welcome" /><p bind={label} /></></main>
)});`,
  );
  execFileSync(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      "--outDir",
      "dist",
      "--jsx",
      "react-jsxdev",
      "--jsxImportSource",
      "@arc/framework/web",
      "--strict",
      "--target",
      "ES2023",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--typeRoots",
      join(root, "node_modules/@types"),
      "consumer.ts",
      "consumer-view.tsx",
    ],
    { cwd: temp, stdio: "pipe" },
  );
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import page from './dist/consumer-view.js';
import {jsx} from '@arc/framework/web/jsx-runtime';
if(page.kind !== 'view' || typeof jsx !== 'function') throw Error('TSX runtime export failure');`,
    ],
    { cwd: temp, stdio: "pipe", env: { ...process.env, NODE_OPTIONS: "" } },
  );
  console.log(
    "Packed ESM package import, CLI graph without resource activation, execution without tsx, and strict TypeScript/TSX consumers: passed",
  );
  // Supply the build peers from the root install so this check works offline.
  for (const peer of ["esbuild", "typescript"]) {
    await symlink(join(root, "node_modules", peer), join(temp, "node_modules", peer), "junction");
  }
  await cp(join(root, "examples/fullstack-tasks"), join(temp, "tasks"), { recursive: true });
  const manifest = JSON.parse(execFileSync(
    process.execPath,
    ["node_modules/@arc/framework/arc.mjs", "build"],
    {
      cwd: temp,
      encoding: "utf8",
      env: { ...process.env, ARC_APP: "tasks/app.ts", NODE_OPTIONS: "" },
    },
  ));
  const runtimeInputs = manifest.inputs
    .map((input) => input.replaceAll("\\", "/"))
    .filter((input) => input.includes("node_modules/@arc/framework/"));
  assert.ok(runtimeInputs.some((input) => input.endsWith("/dist/web/jsx-runtime.js")));
  assert.ok(runtimeInputs.every((input) => input.includes("/dist/")), runtimeInputs.join("\n"));
  console.log("Packed CLI builds Fullstack Tasks with one compiled browser runtime: passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
