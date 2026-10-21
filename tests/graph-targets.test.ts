import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compileArchitecture,
  operationContract,
  s,
  Diagnostic,
} from "../framework/src/core-entry.ts";
import {
  application,
  resource,
  operation,
  ok,
} from "../framework/src/index.ts";
test("IR v3 assigns targets and partitions unified module graph", async () => {
  const server = operation({
    id: "read",
    input: s.object({}),
    output: s.int(),
    run: () => ok(1),
  });
  const state = { id: "counter", kind: "state" as const };
  const app = application({
    modules: [{ id: "feature", operations: [server], web: { nodes: [state] } }],
  });
  await app.compile();
  assert.equal(app.graph().version, 3);
  assert.equal(
    app.graph().nodes.find((n) => n.id === "counter")?.runtime,
    "browser",
  );
  assert.ok(app.graph().partitions?.server.includes("read"));
  await app.close();
});
test("semantic boundaries reject view to DB with graph path", () => {
  const db = resource({ id: "db", open: () => 1 });
  assert.throws(
    () =>
      compileArchitecture([{ id: "page", kind: "view", dependencies: [db] }]),
    (e: any) =>
      e instanceof Diagnostic &&
      e.code === "ARC201" &&
      e.message.includes("db"),
  );
});
test("neutral graph compiler rejects cycles/duplicates and unexposed remote", () => {
  const a: any = { id: "a", kind: "derived", dependencies: [] };
  const b: any = { id: "b", kind: "derived", dependencies: [a] };
  a.dependencies = [b];
  assert.throws(() => compileArchitecture([a]), /cycle/);
  assert.throws(
    () =>
      compileArchitecture([
        { id: "a", kind: "state" },
        { id: "a", kind: "state" },
      ]),
    /Duplicate/,
  );
  const op = operationContract({
    id: "private",
    input: s.object({}),
    output: s.int(),
  });
  assert.throws(
    () =>
      compileArchitecture([
        {
          id: "remote",
          kind: "web-resource",
          relations: [{ kind: "REMOTE_CALLS", to: op }],
        },
      ]),
    /not explicitly/,
  );
});
