import { test } from "node:test";
import assert from "node:assert/strict";
import {
  application,
  operation,
  resource,
  s,
  ok,
} from "../framework/src/index.ts";
import { internalTransport } from "../framework/src/fullstack/server.ts";
import {
  remoteClient,
  remoteCall,
  telemetryTransport,
} from "../framework/src/fullstack/client.ts";
import { operationContract } from "../framework/src/core-entry.ts";
test("fullstack remote validates contracts, exposure, errors and trace continuity", async () => {
  const schema = s.object({ n: s.int() });
  const repo = resource({ id: "repo", open: () => 1 });
  const op = operation({
    id: "double",
    expose: { web: true },
    input: schema,
    output: s.int(),
    needs: { repo },
    errors: { NEGATIVE: { status: 422, details: s.object({ n: s.int() }) } },
    run: ({ input, fail }) =>
      input.n < 0 ? fail("NEGATIVE", { n: input.n }) : ok(input.n * 2),
  });
  const privateOp = operation({
    id: "private",
    input: schema,
    output: s.int(),
    run: () => ok(1),
  });
  const fault = operation({
    id: "fault",
    expose: { web: true },
    input: schema,
    output: s.int(),
    run() {
      throw Error("SUPER_SECRET_CONNECTION_STRING");
    },
  });
  const broken = operation({
    id: "broken",
    expose: { web: true },
    input: schema,
    output: s.int(),
    run: () => ok("wrong" as any),
  });
  const remote = remoteClient(op, { id: "browser.double" });
  const app = application({
    operations: [op, privateOp, fault, broken],
    web: { nodes: [remote] },
  });
  await app.compile();
  await app.start();
  const transport = internalTransport(app),
    fetcher: typeof fetch = async (input, init) =>
      transport(new Request(new URL(String(input), "http://localhost"), init));
  const traceId = crypto.randomUUID(),
    events: any[] = [];
  const options = {
    fetch: fetcher,
    trace: { traceId },
    telemetry: {
      emit(e: any) {
        events.push(e);
      },
    },
  };
  try {
    assert.deepEqual(await remoteCall(op, { n: 2 }, options), {
      ok: true,
      kind: "success",
      value: 4,
    });
    assert.equal(app.traces[0].id, traceId);
    assert.ok(app.traces[0].spans.some((s) => s.parentId === events[0].spanId));
    const business = await remoteCall(op, { n: -1 }, options);
    assert.equal(business.kind, "business_error");
    if (business.kind === "business_error") {
      assert.equal(business.error, "NEGATIVE");
      assert.equal(business.details.n, -1);
    }
    const invalid = await fetcher("/_arc/call/double", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"n":"wrong"}',
    });
    assert.equal(invalid.status, 400);
    assert.equal(
      (await remoteCall(privateOp, { n: 1 }, options)).kind,
      "fault",
    );
    const internal = await remoteCall(fault, { n: 1 }, options);
    assert.equal(internal.kind, "fault");
    assert.ok(!JSON.stringify(internal).includes("SUPER_SECRET"));
    assert.equal((await remoteCall(broken, { n: 1 }, options)).kind, "fault");
    const contract = operationContract({
      id: "double",
      expose: { web: true },
      input: schema,
      output: s.string(),
    });
    await assert.rejects(
      application({
        operations: [op],
        web: { nodes: [remoteClient(contract, { id: "bad" })] },
      }).compile(),
      /contract mismatch/,
    );
  } finally {
    await app.close();
  }
});

test("interaction joins browser action/remote/resource/binding and server spans in Stand", async () => {
  const { parseHTML } = await import("linkedom");
  const { action, binding, view, state, webApplication, tick } =
    await import("../framework/src/web/index.ts");
  const { remote, telemetryTransport } =
    await import("../framework/src/fullstack/client.ts");
  const { stand } = await import("../framework/src/stand.ts");
  let count = 0;
  const list = operation({
    id: "list",
    expose: { web: true },
    input: s.object({}),
    output: s.int(),
    run: () => ok(count),
  });
  const create = operation({
    id: "create",
    expose: { web: true },
    input: s.object({}),
    output: s.int(),
    run: () => ok(++count),
  });
  let app!: ReturnType<typeof application>;
  let transport!: (request: Request) => Promise<Response>;
  const fetcher: typeof fetch = async (input, init) =>
    transport(new Request(new URL(String(input), "http://localhost"), init));
  const data = remote(list, { id: "browser.list", fetch: fetcher });
  const mutation = remoteClient(create, {
    id: "browser.create",
    fetch: fetcher,
  });
  const add = action({
    id: "browser.add",
    needs: { mutation },
    invalidates: [data],
    run: (_, ctx) => mutation.call({}, ctx),
  });
  const text = binding({
      id: "browser.count",
      type: "text",
      sources: [data.data],
      format: (n) => String(n ?? 0),
    }),
    click = binding({
      id: "browser.click",
      type: "event",
      sources: [],
      handler: add,
    });
  const page = view({
    id: "browser.page",
    bindings: [text, click],
    setup({ document, bind }) {
      const root = document.createElement("div"),
        button = document.createElement("button"),
        label = document.createElement("span");
      button.textContent = "Add";
      bind(click, button);
      bind(text, label);
      root.append(button, label);
      return root;
    },
  });
  app = application({ operations: [list, create], web: { nodes: [page] } });
  await app.compile();
  await app.start();
  transport = internalTransport(app);
  const telemetry = telemetryTransport({ fetch: fetcher });
  const web = webApplication({ nodes: [page], telemetry });
  web.compile();
  web.start();
  const { document } = parseHTML('<div id="app"></div>');
  web.mount(page, document.querySelector("#app")! as unknown as Element);
  await new Promise((r) => setTimeout(r, 5));
  await telemetry.flush();
  app.browserEvents.length = 0;
  const traceId = crypto.randomUUID();
  await add.execute(undefined, { trace: { traceId } });
  await tick();
  await telemetry.flush();
  assert.equal(document.querySelector("span")!.textContent, "1");
  assert.ok(app.traces.filter((t) => t.id === traceId).length === 2);
  assert.ok(
    app.browserEvents.some(
      (e) => e.traceId === traceId && e.type === "binding.updated",
    ),
  );
  const response = await stand(app)(new Request("http://localhost/api/live"));
  const live = await response.json();
  const interaction = live.interactions.find((i: any) => i.traceId === traceId);
  assert.equal(interaction.server.length, 2);
  assert.ok(interaction.browser.some((e: any) => e.type === "action.started"));
  assert.ok(
    live.browserMetrics.some(
      (m: any) => m.id === "browser.add" && m.calls === 1,
    ),
  );
  assert.ok(
    live.browserMetrics.some(
      (m: any) => m.id === "browser.page" && m.updates > 0,
    ),
  );
  if (process.env.ARC_EVIDENCE === "1") {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      "docs/audit/fullstack-interaction.json",
      JSON.stringify(interaction, null, 2) + "\n",
    );
  }
  web.dispose();
  await telemetry.dispose();
  await app.close();
});
