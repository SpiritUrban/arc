import { mkdtemp, writeFile, rm } from "node:fs/promises";
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
  assert.equal(graph.version, 2);
  assert.ok(graph.nodes.some((n) => n.id === "offline-db"));
  await writeFile(
    join(temp, "check.mjs"),
    `import {application,operation,s,ok} from '@arc/framework';const app=application({operations:[operation({id:'ping',input:s.object({}),output:s.string(),run:()=>ok('pong')})]});await app.compile();await app.start();console.log(JSON.stringify(await app.execute('ping',{})));await app.close();`,
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
  execFileSync(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      "--noEmit",
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
    ],
    { cwd: temp, stdio: "pipe" },
  );
  console.log(
    "Packed ESM package import, CLI graph without resource activation, execution without tsx, and strict TypeScript consumer: passed",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
