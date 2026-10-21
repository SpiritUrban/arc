import { test } from "node:test";
import assert from "node:assert/strict";
import {
  application,
  operation,
  resource,
  s,
  ok,
  error,
  http,
  handler,
  stand,
  test as operationTest,
  serve,
  closeServer,
} from "../framework/src/index.ts";
const empty = s.object({});
const ping = (id = "ping") =>
  operation({ id, input: empty, output: s.string(), run: () => ok("pong") });
test("schemas validate, strip no unknowns, generate valid samples", () => {
  const schema = s.object({
    id: s.uuid(),
    name: s.string({ min: 2, max: 8 }),
    count: s.int({ min: 1, max: 5 }),
    email: s.email(),
    flag: s.boolean().optional(),
  });
  assert.deepEqual(schema.parse(schema.sample()), schema.sample());
  assert.throws(() => schema.parse({ ...schema.sample(), count: 1.5 }));
  assert.throws(() => schema.parse({ ...schema.sample(), extra: true }));
  assert.throws(() => schema.parse(null));
});
test("compiler rejects cycles, scope leaks, duplicate ids and ambiguous routes", async () => {
  const a = resource({ id: "a", open: () => 1 });
  const b = resource({ id: "b", needs: { a }, open: () => 2 });
  (a as any).needs.b = b;
  await assert.rejects(application({ resources: [a] }).compile(), /Circular/);
  const request = resource({ id: "request", scope: "request", open: () => 1 });
  const singleton = resource({
    id: "singleton",
    needs: { session: request },
    open: () => 1,
  });
  await assert.rejects(
    application({ resources: [singleton] }).compile(),
    /Scope/,
  );
  await assert.rejects(
    application({ operations: [ping(), ping()] }).compile(),
    /Duplicate/,
  );
  const op = ping();
  await assert.rejects(
    application({
      routes: [http.get("/u/:id", op), http.get("/u/:name", op)],
    }).compile(),
    /collision/,
  );
});
test("minimal graph, shared dependency once per request, lifecycle in reverse order", async () => {
  const events: string[] = [];
  let opened = 0;
  const database = resource({
    id: "database",
    open: () => {
      events.push("db.open");
      return 7;
    },
    close: () => {
      events.push("db.close");
    },
  });
  const session = resource({
    id: "session",
    scope: "request",
    needs: { database },
    open: ({ database }) => {
      opened++;
      events.push("session.open");
      return database + 1;
    },
    close: () => {
      events.push("session.close");
    },
  });
  const left = resource({
    id: "left",
    scope: "request",
    needs: { session },
    open: ({ session }) => session,
    close: () => {
      events.push("left.close");
    },
  });
  const right = resource({
    id: "right",
    scope: "request",
    needs: { session },
    open: ({ session }) => session,
    close: () => {
      events.push("right.close");
    },
  });
  const op = operation({
    id: "sum",
    input: empty,
    output: s.int(),
    needs: { left, right },
    run: (ctx) => {
      assert.deepEqual(Object.keys(ctx).sort(), [
        "input",
        "left",
        "right",
        "signal",
      ]);
      return ok(ctx.left + ctx.right);
    },
  });
  const app = application({ operations: [op, ping()] });
  await app.compile();
  await app.execute("ping", {});
  assert.equal(opened, 0);
  assert.deepEqual(await app.execute("sum", {}), ok(16));
  assert.equal(opened, 1);
  assert.equal(events.at(-1), "session.close");
  await app.close();
  assert.equal(events.at(-1), "db.close");
});
test("parallel layer settles before cleanup on failure", async () => {
  let closed = false;
  const slow = resource({
    id: "slow",
    scope: "request",
    async open() {
      await new Promise((r) => setTimeout(r, 20));
      return 1;
    },
    close() {
      closed = true;
    },
  });
  const bad = resource({
    id: "bad",
    scope: "request",
    open() {
      throw Error("bad");
    },
  });
  const op = operation({
    id: "fail",
    input: empty,
    output: s.int(),
    needs: { slow, bad },
    run: () => ok(1),
  });
  const app = application({ operations: [op] });
  await app.compile();
  await assert.rejects(app.execute("fail", {}), /bad/);
  assert.equal(closed, true);
  await app.close();
});
test("expected errors, undeclared errors and output validation", async () => {
  const expected = operation({
    id: "expected",
    input: empty,
    output: s.string(),
    errors: { MISSING: 404 },
    run: () => error("MISSING"),
  });
  const bad = operation({
    id: "bad",
    input: empty,
    output: s.string(),
    run: () => ok(42 as any),
  });
  const app = application({ operations: [expected, bad] });
  await app.compile();
  assert.deepEqual(await app.execute("expected", {}), error("MISSING"));
  await assert.rejects(app.execute("bad", {}), (e: any) => e.status === 500);
  assert.equal(app.traces.length, 2);
  await app.close();
});
test("test harness overrides application resources without opening real resource", async () => {
  const db = resource({
    id: "real",
    open: (): number => {
      throw Error("must not open");
    },
  });
  const op = operation({
    id: "fake",
    input: empty,
    output: s.int(),
    needs: { db },
    run: ({ db }) => ok(db),
  });
  assert.deepEqual(await operationTest(op).provide(db, 42).run({}), ok(42));
});
test("HTTP adapter validates input, maps errors and exports OpenAPI", async () => {
  const op = operation({
    id: "lookup",
    input: s.object({ id: s.uuid() }),
    output: s.string(),
    errors: { MISSING: 404 },
    run: () => error("MISSING"),
  });
  const app = application({ routes: [http.get("/users/:id", op)] });
  await app.compile();
  const fetch = handler(app);
  assert.equal(
    (await fetch(new Request("http://local/users/bad"))).status,
    400,
  );
  assert.equal(
    (
      await fetch(
        new Request("http://local/users/00000000-0000-4000-8000-000000000001"),
      )
    ).status,
    404,
  );
  const spec = await (
    await fetch(new Request("http://local/openapi.json"))
  ).json();
  assert.equal(spec.paths["/users/{id}"].get.parameters[0].in, "path");
  await app.close();
});
test("Stand graph, run, saved tests, load and failure injection", async () => {
  const app = application({ operations: [ping()] });
  await app.compile();
  const fetch = stand(app);
  const post = (path: string, body: unknown) =>
    fetch(
      new Request("http://localhost/api/" + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  assert.equal(
    (await (await fetch(new Request("http://localhost/api/graph"))).json())
      .nodes.length,
    1,
  );
  assert.deepEqual(
    await (await post("run", { operation: "ping", input: {} })).json(),
    ok("pong"),
  );
  await post("test/save", {
    operation: "ping",
    input: {},
    expected: ok("pong"),
  });
  assert.equal((await (await post("test/run", {})).json())[0].passed, true);
  const load = await (
    await post("load", {
      operation: "ping",
      input: {},
      count: 8,
      concurrency: 3,
    })
  ).json();
  assert.equal(load.completed, 8);
  assert.equal(load.errors, 0);
  await post("fault", { node: "ping", errorRate: 1 });
  assert.equal(
    (await post("run", { operation: "ping", input: {} })).status,
    503,
  );
  await post("fault", { node: "ping", clear: true });
  await app.close();
});
test("Node server serves real HTTP and shuts down", async () => {
  const op = ping();
  const app = application({ routes: [http.get("/ping", op)] });
  await app.compile();
  const server = await serve(handler(app), { port: 0 });
  try {
    const address = server.address() as { port: number };
    const response = await fetch("http://127.0.0.1:" + address.port + "/ping");
    assert.equal(response.status, 200);
    assert.equal(await response.json(), "pong");
  } finally {
    await closeServer(server);
    await app.close();
  }
});

test("RPC explicit exposure and queue bounded concurrency", async () => {
  const { rpc, queue, client } = await import("../framework/src/transports.ts");
  let active = 0,
    maxActive = 0;
  const op = operation({
    id: "work",
    input: s.object({ value: s.int() }),
    output: s.int(),
    async run({ input }) {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return ok(input.value * 2);
    },
  });
  const app = application({ operations: [op] });
  await app.compile();
  const request = rpc(app, { "work.double": op });
  const response = await request(
    new Request("http://local/rpc", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "work.double",
        params: { value: 3 },
      }),
    }),
  );
  assert.deepEqual(await response.json(), { jsonrpc: "2.0", id: 1, result: 6 });
  const worker = queue(app, op, { concurrency: 2 });
  const jobs = Array.from({ length: 8 }, (_, value) =>
    worker.enqueue({ value }),
  );
  await worker.close();
  assert.equal((await Promise.all(jobs)).length, 8);
  assert.equal(maxActive, 2);
  assert.equal(worker.metrics().completed, 8);
  await assert.rejects(worker.enqueue({ value: 1 }), /closed/);
  assert.deepEqual(
    await client(app, { double: op }).double({ value: 5 }),
    ok(10),
  );
  await app.close();
});

test("overriding a repository prunes its real external dependencies", async () => {
  const external = resource({
    id: "external",
    open: (): number => {
      throw Error("External DB must not open");
    },
  });
  const repository = resource({
    id: "repository",
    needs: { external },
    open: ({ external }) => ({ value: external }),
  });
  const op = operation({
    id: "read",
    input: empty,
    output: s.int(),
    needs: { repository },
    run: ({ repository }) => ok(repository.value),
  });
  assert.deepEqual(
    await operationTest(op).provide(repository, { value: 11 }).run({}),
    ok(11),
  );
});
