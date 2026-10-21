import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import {
  application,
  operation,
  resource,
  s,
  ok,
  error,
  stand,
  generateCases,
  runLoad,
  findBreakingPoint,
  MetricsAccumulator,
  matches,
  runTestSpec,
} from "../framework/src/index.ts";
const empty = s.object({});
test("schema corpus covers numeric and string boundaries, formats, arrays and optional fields", () => {
  const numeric = generateCases(s.int({ min: 2, max: 5 }));
  for (const n of [1, 2, 3, 4, 5, 6])
    assert.ok(numeric.some((c) => c.value === n));
  assert.equal(numeric.find((c) => c.value === 1)!.valid, false);
  const strings = generateCases(s.string({ min: 2, max: 4 }));
  for (const length of [0, 1, 2, 3, 4, 5])
    assert.ok(
      strings.some(
        (c) => typeof c.value === "string" && c.value.length === length,
      ),
    );
  for (const schema of [
    s.uuid(),
    s.email(),
    s.boolean(),
    s.literal("x"),
    s.int().array(),
    s.object({ n: s.int({ min: 1 }), name: s.string().optional() }),
  ]) {
    const cases = generateCases(schema);
    assert.ok(cases.some((c) => c.valid));
    assert.ok(cases.some((c) => !c.valid));
    for (const c of cases) {
      if (c.valid) assert.doesNotThrow(() => schema.parse(c.value));
      else assert.throws(() => schema.parse(c.value));
    }
  }
});
test("metrics survive trace eviction; outcomes, concurrency, window expiration", async () => {
  const op = operation({
    id: "ping",
    input: empty,
    output: s.int(),
    run: () => ok(1),
  });
  const app = application({ operations: [op], traceLimit: 1 });
  await app.compile();
  await app.start();
  await Promise.all(Array.from({ length: 20 }, () => app.execute("ping", {})));
  assert.equal(app.traces.length, 1);
  const metric = app.metrics()[0];
  assert.equal(metric.totalCalls, 20);
  assert.equal(metric.rpm, 20);
  assert.equal(metric.ok, 20);
  assert.ok(metric.peakConcurrent > 1);
  assert.equal(metric.active, 0);
  await app.close();
  let now = 0;
  const meter = new MetricsAccumulator(1000, () => now);
  meter.end(meter.begin("op"), "business_error");
  now = 2000;
  assert.equal(meter.snapshot()[0].rpm, 1);
  assert.equal(meter.snapshot()[0].p99, 0);
  now = 61000;
  assert.equal(meter.snapshot()[0].rpm, 0);
  assert.equal(meter.snapshot()[0].totalCalls, 1);
});
test("explicit async resource methods get effect nodes, fault/timeout/latency and child spans", async () => {
  let calls = 0,
    closed = false;
  const repo = resource({
    id: "repo",
    instrument: ["read"],
    open: () => ({
      async read() {
        calls++;
        return 1;
      },
    }),
    close() {
      closed = true;
    },
  });
  const op = operation({
    id: "read",
    input: empty,
    output: s.int(),
    needs: { repo },
    run: async ({ repo }) => ok(await repo.read()),
  });
  const app = application({ operations: [op] });
  await app.compile();
  assert.ok(
    app.graph().nodes.some((n) => n.kind === "effect" && n.id === "repo.read"),
  );
  await app.start();
  await app.execute("read", {});
  assert.equal(calls, 1);
  assert.ok(
    app.traces[0].spans.some((s) => s.node === "repo.read" && s.parentId),
  );
  for (const fault of [
    { unavailable: true },
    { timeoutMs: 1 },
    { errorRate: 1 },
  ]) {
    app.faults.set("repo.read", fault);
    await assert.rejects(app.execute("read", {}));
  }
  assert.equal(calls, 1);
  app.faults.set("repo.read", { latencyMs: 5 });
  await app.execute("read", {});
  assert.equal(calls, 2);
  await app.close();
  assert.equal(closed, true);
});
test("cleanup failures count as faults rather than successful operations", async () => {
  const r = resource({
    id: "r",
    scope: "request",
    open: () => 1,
    close() {
      throw Error("cleanup");
    },
  });
  const op = operation({
    id: "go",
    input: empty,
    output: s.int(),
    needs: { r },
    run: () => ok(1),
  });
  const app = application({ operations: [op] });
  await app.compile();
  await app.start();
  await assert.rejects(app.execute("go", {}));
  assert.equal(app.metrics()[0].fault, 1);
  assert.equal(app.metrics()[0].ok, 0);
  await app.close();
});
test("load generator count/duration/RPS/ramp/concurrency and breaking constraints", async () => {
  const result = await runLoad(async () => ({ kind: "ok" }), {
    count: 5,
    targetRps: 1000,
    concurrency: 2,
    rampUpMs: 5,
    durationMs: 100,
  });
  assert.equal(result.completed, 5);
  assert.ok(result.peakConcurrent <= 2);
  const timed = await runLoad(async () => ({ kind: "ok" }), {
    durationMs: 10,
    targetRps: 1000,
  });
  assert.ok(timed.completed > 0);
  assert.ok(timed.completed < 100);
  const breaking = await findBreakingPoint(async () => ({ kind: "fault" }), {
    count: 3,
    durationMs: 20,
    steps: 2,
    initialRps: 1000,
    maxRps: 2000,
    constraints: { maxFaultRate: 0 },
  });
  assert.ok(breaking.firstFailingRps);
  assert.equal(breaking.lastPassingRps, null);
  assert.ok(breaking.rounds.every((r) => !r.passed));
});
test("matcher supports UUID/time, reusable specs retain explicit context and run hooks", async () => {
  assert.ok(
    matches(
      {
        id: "00000000-0000-4000-8000-000000000001",
        time: new Date().toISOString(),
      },
      { id: { $match: "uuid" }, time: { $match: "iso-date" } },
    ),
  );
  assert.equal(matches({ id: "bad" }, { id: { $match: "uuid" } }), false);
  const user = resource({
    id: "user",
    scope: "request",
    open: ({ request }) => request?.headers.get("authorization") ?? "",
  });
  const op = operation({
    id: "who",
    input: empty,
    output: s.string(),
    needs: { user },
    run: ({ user }) => ok(user),
  });
  const app = application({ operations: [op] });
  await app.compile();
  await app.start();
  const hooks: string[] = [];
  const result = await runTestSpec(
    app,
    {
      version: 1,
      name: "auth",
      operation: "who",
      input: {},
      expected: { ok: true, value: "Bearer demo" },
      request: { authorization: "Bearer demo" },
      setup: "seed",
      reset: "reset",
    },
    {
      seed: () => {
        hooks.push("seed");
      },
      reset: () => {
        hooks.push("reset");
      },
    },
  );
  assert.equal(result.passed, true);
  assert.deepEqual(hooks, ["seed", "reset"]);
  await app.close();
});
test("Stand exports/imports/persists specs and provides SSE without trace-driven architecture", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arc-stand-"));
  const op = operation({
    id: "ping",
    input: empty,
    output: s.int(),
    run: () => ok(1),
  });
  const app = application({ operations: [op] });
  await app.compile();
  await app.start();
  const options = { testFile: join(dir, "tests.json") };
  const fetch = stand(app, options);
  const post = (path: string, body: unknown) =>
    fetch(
      new Request("http://localhost/api/" + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  try {
    await post("test/save", {
      operation: "ping",
      input: {},
      expected: { ok: true, value: { $match: "type", type: "number" } },
      authorization: "Bearer secret",
      includeContext: true,
      persist: true,
    });
    const exported = await (
      await fetch(new Request("http://localhost/api/test/export"))
    ).json();
    assert.equal(exported[0].request, undefined);
    const second = stand(app, options);
    assert.equal(
      (await (await second(new Request("http://localhost/api/live"))).json())
        .tests.length,
      1,
    );
    assert.equal((await (await post("test/run", {})).json())[0].passed, true);
    const controller = new AbortController();
    const stream = await fetch(
      new Request("http://localhost/api/events", { signal: controller.signal }),
    );
    const reader = stream.body!.getReader();
    await reader.read();
    await app.execute("ping", {});
    const event = await reader.read();
    assert.match(new TextDecoder().decode(event.value), /operation.started/);
    controller.abort();
    await reader.cancel();
    const html = await (await fetch(new Request("http://localhost"))).text();
    new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)![1]);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("compile analysis marks unknown estimates, computes blast radius and declared-path budget warning", async () => {
  const db = resource({ id: "db", estimateMs: 3, open: () => 1 });
  const op = operation({
    id: "op",
    input: empty,
    output: s.int(),
    needs: { db },
    estimateMs: 5,
    budgetMs: 6,
    run: () => ok(1),
  });
  const app = application({ operations: [op] });
  await app.compile();
  const analysis = app.graph().analysis!;
  assert.equal(
    analysis.nodes.find((n) => n.id === "op")!.compilerDerivedCriticalPathMs,
    8,
  );
  assert.deepEqual(analysis.nodes.find((n) => n.id === "db")!.blastRadius, [
    "op",
  ]);
  assert.ok(analysis.warnings.some((w) => w.code === "BUDGET_EXCEEDED"));
  await app.close();
});

test("real network Stand load and SSE streaming pass through Node HTTP bridge", async () => {
  const { serve, closeServer, http } =
    await import("../framework/src/index.ts");
  const op = operation({
    id: "network",
    input: empty,
    output: s.int(),
    run: () => ok(1),
  });
  const app = application({ routes: [http.get("/ping", op)] });
  await app.compile();
  await app.start();
  const applicationServer = await serve(
    (await import("../framework/src/http.ts")).handler(app),
    { port: 0 },
  );
  const address = applicationServer.address() as { port: number };
  const web = stand(app, {
    networkBaseUrl: `http://127.0.0.1:${address.port}`,
  });
  const standServer = await serve(web, { port: 0 });
  const standAddress = standServer.address() as { port: number };
  try {
    const loaded = await web(
      new Request("http://localhost/api/load", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "network",
          mode: "network",
          input: {},
          count: 3,
          concurrency: 2,
        }),
      }),
    );
    const result = await loaded.json();
    assert.equal(result.completed, 3);
    assert.equal(result.errors, 0);
    assert.equal(result.mode, "network");
    const controller = new AbortController();
    const response = await fetch(
      `http://127.0.0.1:${standAddress.port}/api/events`,
      { signal: controller.signal },
    );
    const reader = response.body!.getReader();
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /connected/,
    );
    await app.execute("network", {});
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /operation.started/,
    );
    controller.abort();
    await reader.cancel().catch(() => {});
  } finally {
    app.publish("application.stopping", "application");
    await closeServer(standServer);
    await closeServer(applicationServer);
    await app.close();
  }
});
