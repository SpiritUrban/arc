import { test } from "node:test";
import assert from "node:assert/strict";
import {
  application,
  resource,
  operation,
  s,
  ok,
  error,
  http,
  queue,
  schedule,
  openapi,
} from "../framework/src/index.ts";
const empty = s.object({});
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}
test("compile/inspect graph never call open/sample; start is concurrent-idempotent and close joins start", async () => {
  let opened = 0,
    closed = 0;
  const gate = latch();
  const r = resource({
    id: "db",
    async open() {
      opened++;
      await gate.promise;
      return 1;
    },
    close() {
      closed++;
    },
  });
  const op = operation({
    id: "read",
    needs: { db: r },
    input: empty,
    output: s.int(),
    run: ({ db }) => ok(db),
  });
  const app = application({ operations: [op] });
  await app.compile();
  assert.equal(opened, 0);
  assert.equal(app.graph().version, 3);
  assert.equal(opened, 0);
  await assert.rejects(app.execute("read", {}), /Start/);
  const starting = app.start();
  assert.equal(starting, app.start());
  const closing = app.close();
  gate.release();
  await starting;
  await closing;
  assert.equal(opened, 1);
  assert.equal(closed, 1);
  await assert.rejects(app.execute("read", {}));
});
test("partial activation failure rolls back opened resources, permits retry", async () => {
  const events: string[] = [];
  let fail = true;
  const a = resource({
    id: "a",
    open() {
      events.push("a.open");
      return 1;
    },
    close() {
      events.push("a.close");
    },
  });
  const b = resource({
    id: "b",
    needs: { a },
    open() {
      if (fail) throw Error("offline");
      return 2;
    },
  });
  const app = application({ resources: [b] });
  await app.compile();
  await assert.rejects(app.start(), /offline/);
  assert.deepEqual(events, ["a.open", "a.close"]);
  fail = false;
  await app.start();
  await app.close();
  assert.deepEqual(events, ["a.open", "a.close", "a.open", "a.close"]);
});
test("dependency-ready DAG advances fast branch before slow independent branch completes", async () => {
  const gate = latch(),
    advanced = latch();
  const events: string[] = [];
  const slow = resource({
    id: "slow",
    scope: "request",
    async open() {
      await gate.promise;
      events.push("slow");
      return 1;
    },
  });
  const fast = resource({ id: "fast", scope: "request", open: () => 1 });
  const child = resource({
    id: "child",
    scope: "request",
    needs: { fast },
    open() {
      events.push("child");
      advanced.release();
      return 1;
    },
  });
  const op = operation({
    id: "go",
    input: empty,
    output: s.int(),
    needs: { slow, child },
    run: () => ok(1),
  });
  const app = application({ operations: [op] });
  await app.compile();
  await app.start();
  const execution = app.execute("go", {});
  await advanced.promise;
  assert.deepEqual(events, ["child"]);
  gate.release();
  await execution;
  await app.close();
});
test("nested calls share request scope, Request and AbortSignal; spans have parent links", async () => {
  let opens = 0,
    closes = 0;
  const controller = new AbortController();
  const request = new Request("http://localhost", {
    headers: { authorization: "Bearer test" },
  });
  const shared = resource({
    id: "shared",
    scope: "request",
    open({ request: actual, signal }) {
      assert.equal(actual, request);
      assert.equal(signal, controller.signal);
      return ++opens;
    },
    close() {
      closes++;
    },
  });
  const child = operation({
    id: "child",
    input: empty,
    output: s.int(),
    needs: { shared },
    run: ({ shared, signal }) => {
      assert.equal(signal, controller.signal);
      return ok(shared);
    },
  });
  const parent = operation({
    id: "parent",
    calls: { child },
    needs: { shared },
    input: empty,
    output: s.int(),
    async run({ call, shared }) {
      const results = await Promise.all([call("child", {}), call("child", {})]);
      assert.deepEqual(results, [ok(shared), ok(shared)]);
      return ok(shared);
    },
  });
  const app = application({ operations: [parent] });
  await app.compile();
  assert.ok(
    app.graph().edges.some((e) => e.kind === "CALLS" && e.to === "child"),
  );
  await app.start();
  await app.execute("parent", {}, { request, signal: controller.signal });
  assert.equal(opens, 1);
  assert.equal(closes, 1);
  const trace = app.traces[0],
    root = trace.spans.find((s) => s.node === "parent")!;
  assert.equal(
    trace.spans.filter((s) => s.node === "child" && s.parentId === root.id)
      .length,
    2,
  );
  assert.equal(app.traces.length, 1);
  await app.close();
});
test("call cycles and undeclared calls rejected; detached nested calls joined before cleanup", async () => {
  const child = operation({
    id: "child",
    input: empty,
    output: s.int(),
    run: () => ok(1),
  });
  const cyclic = operation({
    id: "cycle",
    calls: { child },
    input: empty,
    output: s.int(),
    run: () => ok(1),
  });
  (child.calls as any).back = cyclic;
  await assert.rejects(
    application({ operations: [cyclic] }).compile(),
    /Circular/,
  );
  delete (child.calls as any).back;
  let disposed = false;
  const r = resource({
    id: "r",
    scope: "request",
    open: () => 1,
    close() {
      disposed = true;
    },
  });
  const slow = operation({
    id: "slow",
    input: empty,
    output: s.int(),
    needs: { r },
    async run() {
      await pause(10);
      assert.equal(disposed, false);
      return ok(1);
    },
  });
  const parent = operation({
    id: "parent",
    calls: { slow },
    input: empty,
    output: s.int(),
    run({ call }) {
      void call("slow", {});
      return ok(1);
    },
  });
  const app = application({ operations: [parent] });
  await app.compile();
  await app.start();
  await app.execute("parent", {});
  assert.equal(disposed, true);
  await app.close();
});
test("abort prevents new ready nodes; partial siblings settle before deterministic cleanup", async () => {
  const c = new AbortController();
  const events: string[] = [];
  const a = resource({
    id: "a",
    scope: "request",
    async open() {
      await pause(10);
      events.push("open");
      c.abort();
      return 1;
    },
    close() {
      events.push("close");
    },
  });
  const b = resource({
    id: "b",
    scope: "request",
    needs: { a },
    open() {
      events.push("should-not-open");
      return 2;
    },
  });
  const op = operation({
    id: "run",
    input: empty,
    output: s.int(),
    needs: { b },
    run: () => ok(1),
  });
  const app = application({ operations: [op] });
  await app.compile();
  await app.start();
  await assert.rejects(app.execute("run", {}, { signal: c.signal }));
  assert.deepEqual(events, ["open", "close"]);
  assert.equal(app.metrics()[0].cancelled, 1);
  await app.close();
});
test("typed errors validate details and OpenAPI; undeclared code is a fault", async () => {
  const op = operation({
    id: "err",
    input: empty,
    output: s.int(),
    errors: { MISSING: { status: 404, details: s.object({ id: s.uuid() }) } },
    run: ({ fail }) =>
      fail("MISSING", { id: "00000000-0000-4000-8000-000000000001" }),
  });
  const invalid = operation({
    id: "invalid",
    input: empty,
    output: s.int(),
    run: (() => error("UNDECLARED")) as any,
  });
  const app = application({
    operations: [invalid],
    routes: [http.get("/err", op)],
  });
  await app.compile();
  await app.start();
  assert.equal((await app.execute("err", {})).ok, false);
  await assert.rejects(
    app.execute("invalid", {}),
    (e: any) => e.code === "UNDECLARED_ERROR",
  );
  const response = openapi(app).paths["/err"].get.responses["404"];
  assert.equal(
    response.content["application/json"].schema.properties.details.type,
    "object",
  );
  await app.close();
});
test("queue/worker/ingress/schedule are compiled IR nodes, application owns drain", async () => {
  const op = operation({
    id: "job",
    input: empty,
    output: s.int(),
    async run() {
      await pause(2);
      return ok(1);
    },
  });
  const jobs = queue({ id: "jobs", operation: op, concurrency: 1 });
  const timer = schedule({
    id: "timer",
    operation: op,
    everyMs: 100000,
    input: () => ({}),
  });
  const app = application({
    routes: [http.get("/jobs", op)],
    queues: [jobs],
    schedules: [timer],
  });
  await app.compile();
  assert.deepEqual(
    new Set(app.graph().nodes.map((n) => n.kind)),
    new Set([
      "operation",
      "http-route",
      "queue",
      "worker",
      "schedule",
      "contract",
    ]),
  );
  await app.start();
  const results = [
    app.queues.get("jobs")!.enqueue({}),
    app.queues.get("jobs")!.enqueue({}),
  ];
  await app.close();
  assert.equal((await Promise.all(results)).length, 2);
  await assert.rejects(app.queues.get("jobs")!.enqueue({}));
});

test("close rejects new public executions immediately while draining an active context", async () => {
  const ready = latch(),
    gate = latch();
  let closed = false;
  const r = resource({
    id: "connection",
    open: () => 1,
    close() {
      closed = true;
    },
  });
  const op = operation({
    id: "long",
    input: empty,
    output: s.int(),
    needs: { r },
    async run() {
      ready.release();
      await gate.promise;
      assert.equal(closed, false);
      return ok(1);
    },
  });
  const app = application({ operations: [op] });
  await app.compile();
  await app.start();
  const running = app.execute("long", {});
  await ready.promise;
  const closing = app.close();
  await assert.rejects(app.execute("long", {}));
  gate.release();
  await running;
  await closing;
  assert.equal(closed, true);
});

test("request cleanup is deterministic across sibling completion order and still closes after cleanup failure", async () => {
  const events: string[] = [];
  const a = resource({
    id: "a",
    scope: "request",
    async open() {
      await pause(10);
      return 1;
    },
    close() {
      events.push("a");
    },
  });
  const b = resource({
    id: "b",
    scope: "request",
    open: () => 1,
    close() {
      events.push("b");
      throw Error("b.close");
    },
  });
  const root = resource({
    id: "root",
    scope: "request",
    needs: { a, b },
    open: () => 1,
    close() {
      events.push("root");
    },
  });
  const op = operation({
    id: "run",
    input: empty,
    output: s.int(),
    needs: { root },
    run: () => ok(1),
  });
  const app = application({ operations: [op] });
  await app.compile();
  await app.start();
  await assert.rejects(app.execute("run", {}));
  assert.deepEqual(events, ["root", "b", "a"]);
  await app.close();
});

test("pure compilation rejects impossible schemas and slash-equivalent route collisions", async () => {
  const op = operation({
    id: "bad",
    input: s.object({ n: s.int({ min: 3, max: 1 }) }),
    output: s.int(),
    run: () => ok(1),
  });
  await assert.rejects(
    application({ operations: [op] }).compile(),
    /Impossible schema/,
  );
  const good = operation({
    id: "good",
    input: empty,
    output: s.int(),
    run: () => ok(1),
  });
  await assert.rejects(
    application({
      routes: [http.get("/same", good), http.get("/same/", good)],
    }).compile(),
    /collision/,
  );
});

test("falsy JavaScript exceptions are faults, never successful undefined results", async () => {
  const op = operation({
    id: "falsy",
    input: empty,
    output: s.int(),
    run() {
      throw undefined;
    },
  });
  const app = application({ operations: [op] });
  await app.compile();
  await app.start();
  await assert.rejects(app.execute("falsy", {}));
  assert.equal(app.metrics()[0].fault, 1);
  assert.equal(app.metrics()[0].ok, 0);
  await app.close();
});
