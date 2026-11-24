import { test } from "node:test";
import assert from "node:assert/strict";
import {
  application,
  compileArchitecture,
  operation,
  resource,
  s,
  ok,
} from "../framework/src/index.ts";
import { internalTransport } from "../framework/src/fullstack/server.ts";
import {
  mutation,
  query,
  remoteClient,
  remoteCall,
  remoteApi,
  setFrom,
  telemetryTransport,
  type RemoteQuery,
} from "../framework/src/fullstack/client.ts";
import { operationContract } from "../framework/src/core-entry.ts";
import { jsx, reactiveEvent } from "../framework/src/web/jsx-runtime.ts";
import { state, tick } from "../framework/src/web/reactive.ts";
import { pageView, view } from "../framework/src/web/view.ts";

test("remote clients share static headers and transport between queries and mutations", async () => {
  const input = s.object({});
  const read = operationContract({ id: "client.read", input, output: s.string() });
  const write = operationContract({ id: "client.write", input, output: s.string() });
  for (const headers of [undefined, { "x-api-version": "2" }]) {
    const requests: unknown[] = [];
    const client = remoteApi({
      baseUrl: "https://example.test",
      headers,
      fetch: async (url, init) => {
        const sent = new Headers(init?.headers);
        requests.push([String(url), sent.get("x-api-version"), sent.get("content-type")]);
        return Response.json({ ok: true, value: "Ready" });
      },
    });
    const data = client.query(read, { cache: true });
    const save = client.mutation(write);
    try {
      await data.refresh();
      assert.equal(data.data(), "Ready");
      assert.equal((await save.run({})).ok, true);
      assert.deepEqual(requests, ["client.read", "client.write"].map((id) => [
        `https://example.test/_arc/call/${id}`, headers?.["x-api-version"] ?? null, "application/json",
      ]));
    } finally {
      data.dispose();
      save.dispose();
    }
  }
});

test("page operations use only route parameters declared by the contract", async () => {
  const input = s.object({ id: s.string() });
  const read = operationContract({ id: "route.read", input, output: s.string() });
  const localized = s.object({ id: s.string(), locale: s.string() });
  const detail = operationContract({ id: "route.detail", input: localized, output: s.string() });
  const ranked = operationContract({
    id: "route.ranked",
    input: s.object({ id: s.string(), rank: s.int(), limit: s.int().optional() }),
    output: s.string(),
  });
  const write = operationContract({ id: "route.write", input, output: s.string() });
  const publish = operationContract({ id: "route.publish", input: localized, output: s.string() });
  const source = state({ id: "route.source", initial: "Workspace" });
  const requests: unknown[] = [];
  const remote = remoteApi({
    from: source,
    headers: () => ({}),
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true, value: "Ready" });
    },
  });
  const calls: unknown[] = [];
  const cacheKeys: string[] = [];
  const cachedQueries: RemoteQuery<typeof read>[] = [];
  const projectedQueries: RemoteQuery<typeof detail>[] = [];
  const client = new Proxy(remote, {
    get(target, key) {
      const method = Reflect.get(target, key);
      return (contract: typeof read | typeof detail | typeof ranked, options: { params: unknown; input?: unknown }) => {
        if (!options.input) calls.push(contract.input.parse(options.params));
        return method(contract, options);
      };
    },
  });
  const page = pageView("route.page", ({ bind, query, mutation }) => {
    query(client, read);
    const scoped = bind(client);
    cachedQueries.push(scoped.query(read, {
      cache: true,
      key: (owner) => {
        if (false) {
          // @ts-expect-error The cache key receives the string source.
          owner.toFixed();
        }
        const key = owner.toLowerCase();
        cacheKeys.push(key);
        return key;
      },
    }));
    const details = scoped.query(detail, { params: { locale: "uk" } });
    assert.equal(details.id, "route.page.route.detail.query");
    projectedQueries.push(scoped.query(detail, {
      id: "route.detail.projected",
      input: (owner) => {
        if (false) {
          // @ts-expect-error The input projection receives the string source.
          owner.toFixed();
        }
        const locale = owner.toLowerCase();
        return owner === "Workspace" ? { locale } : { locale, id: "override" };
      },
    }));
    scoped.query(ranked, { params: { rank: 7 }, key: true });
    const keyed = scoped.mutation(write, { id: "route.write.default", key: "id" });
    assert.equal(keyed.id, "route.write.default");
    assert.equal(keyed.pending("route"), false);
    if (false) {
      // @ts-expect-error The selected input field contains a string key.
      keyed.pending(1);
      // @ts-expect-error The route does not supply the required locale.
      scoped.query(detail, { cache: true });
      // @ts-expect-error The route's string rank cannot supply an integer field.
      scoped.query(ranked);
      // @ts-expect-error An input projection still supplies required non-route fields.
      scoped.query(detail, { input: () => ({}) });
    }
    const localizedWrite = scoped.mutation(publish, { key: "id", params: { locale: "uk" } });
    if (false) {
      // @ts-expect-error The direct binding also requires locale.
      localizedWrite.for("route");
    }
    scoped.mutation(publish, {
      id: "route.publish.override",
      params: { id: "override", locale: "uk" },
    });
    mutation(client, write, { params: { id: "explicit" } });
    return jsx("div", {});
  }, { owner: "workspace", id: "route", rank: "2", limit: "10" });

  assert.deepEqual(calls, [
    { id: "route" },
    { id: "route" },
    { id: "route", locale: "uk" },
    { id: "route", rank: 7 },
    { id: "route" },
    { id: "route", locale: "uk" },
    { id: "override", locale: "uk" },
    { id: "explicit" },
  ]);
  assert.equal(page.owned?.length, 9);
  await cachedQueries[0].refresh();
  assert.ok(cacheKeys.includes("workspace"));
  assert.equal(cachedQueries[0].data(), "Ready");
  await projectedQueries[0].refresh();
  source.set("UK");
  await projectedQueries[0].refresh();
  assert.deepEqual(requests, [
    { id: "route" },
    { id: "route", locale: "workspace" },
    { id: "override", locale: "uk" },
  ]);
  for (const node of page.owned ?? []) node.dispose();
  source.dispose();
});

test("mutation updates can copy a response field into state", async () => {
  const write = operationContract({
    id: "selection.write",
    input: s.object({}),
    output: s.object({ id: s.string(), count: s.int() }),
  });
  const selected = state({ id: "selection.id", initial: "" });
  const count = state({ id: "selection.count", initial: "" });
  if (false) {
    // @ts-expect-error The response does not contain an email.
    mutation(write, { update: setFrom(selected, "email") });
    // @ts-expect-error The response count cannot be written to string state.
    mutation(write, { update: setFrom(count, "count") });
  }
  const save = mutation(write, {
    update: [setFrom(selected, "id"), setFrom(count, (output) => String(output.count))],
    fetch: async () => Response.json({ ok: true, value: { id: "first", count: 3 } }),
  });
  try {
    assert.equal((await save.run({})).ok, true);
    assert.equal(selected(), "first");
    assert.equal(count(), "3");
  } finally {
    save.dispose();
    selected.dispose();
    count.dispose();
  }
});

test("query selections react to data and share the query lifetime", async () => {
  const read = operationContract({
    id: "rows.read",
    input: s.object({}),
    output: s.array(s.string()),
  });
  const index = state({ id: "rows.index", initial: 0 });
  const fallback = state({ id: "rows.fallback", initial: "empty" });
  let reads = 0;
  const rows = query(read, {
    fetch: async () => {
      reads++;
      return Response.json({ ok: true, value: ["first", "second"] });
    },
  });
  try {
    if (false) {
      // @ts-expect-error The query rows do not have an id field.
      rows.insertBy();
      // @ts-expect-error The query rows do not have an id field.
      rows.replaceBy();
    }
    assert.throws(() => rows.select("size", () => {
      throw new Error("invalid selector");
    }), /invalid selector/);
    const size = rows.select("size", (data) => data?.length ?? 0);
    const current = rows.select("current", [index, fallback], (data, index, fallback) =>
      data?.[index] ?? fallback,
    );
    assert.equal(size.id, "rows.read.query.select.size");
    assert.equal(size(), 0);
    assert.equal(current(), "empty");
    assert.equal(rows.data(), undefined);
    await rows.refresh();
    assert.equal(size(), 2);
    assert.equal(current(), "first");
    index.set(1);
    await tick();
    assert.equal(current(), "second");
    assert.equal(reads, 1);
    assert.deepEqual(rows.data(), ["first", "second"]);
    rows.dispose();
    assert.throws(() => size.subscribe(() => {}), /Disposed derived/);
    assert.equal(index._children.size, 0);
    assert.equal(fallback._children.size, 0);
    assert.throws(() => rows.select("again", () => 0), /Disposed query/);
  } finally {
    rows.dispose();
    index.dispose();
    fallback.dispose();
  }
});

test("mutation field validation shares one reactive value per field", async () => {
  const write = operationContract({
    id: "fields.write",
    input: s.object({
      quantity: s.int({ min: 0.5, max: 9.5 }),
      price: s.number({ min: 0.25 }).optional(),
      email: s.email().optional(),
      title: s.string({ max: 80 }).optional(),
    }),
    output: s.int(),
    errors: { EMAIL_EXISTS: 409, CONFLICT: 409 },
  });
  let failure: "EMAIL_EXISTS" | "CONFLICT" | undefined;
  const save = mutation(write, {
    fieldErrors: { email: "EMAIL_EXISTS" },
    fetch: async () => failure
      ? Response.json({ ok: false, kind: "business_error", error: failure }, { status: 409 })
      : Response.json({ ok: true, value: 1 }),
  });
  try {
    const invalid = save.invalidField("quantity");
    assert.equal(save.invalidField("quantity"), invalid);
    const quantity = save.field("quantity");
    assert.equal(quantity.invalid, invalid);
    assert.deepEqual(quantity.input, {
      name: "quantity", "aria-invalid": invalid, required: true, type: "number", min: 1, max: 9, step: 1,
    });
    const { input: price } = save.field("price");
    assert.equal(price.required, false);
    assert.equal(price.min, 0.25);
    assert.equal(price.step, "any");
    const email = save.field("email");
    assert.equal(email.input.type, "email");
    assert.equal(email.invalid, save.field("email").invalid);
    assert.equal(save.field("title").input.maxlength, 80);
    assert.equal(invalid(), false);
    await assert.rejects(save.run({ quantity: 0 }));
    assert.equal(save.invalid("quantity"), true);
    assert.equal(invalid(), true);
    await save.run({ quantity: 1 });
    assert.equal(invalid(), false);
    failure = "CONFLICT";
    await save.run({ quantity: 1 });
    assert.equal(email.invalid(), false);
    assert.equal(email.failed(), false);
    failure = "EMAIL_EXISTS";
    await save.run({ quantity: 1 });
    assert.equal(email.invalid(), true);
    assert.equal(email.failed(), true);
    assert.equal(quantity.failed(), false);
    assert.equal(save.invalid("email"), false);
    assert.equal(invalid(), false);
    failure = undefined;
    await save.run({ quantity: 1 });
    assert.equal(email.invalid(), false);
    assert.equal(email.failed(), false);
    save.dispose();
    assert.throws(() => invalid.subscribe(() => {}), /Disposed derived/);
  } finally {
    save.dispose();
  }
});

test("named forms normalize blank optional fields and read enabled checkboxes", async () => {
  const write = operationContract({
    id: "preferences.write",
    input: s.object({
      checked: s.boolean(),
      unchecked: s.boolean(),
      disabled: s.boolean().optional(),
      quantity: s.int().optional(),
      contact: s.email().optional(),
      note: s.string().optional(),
      requiredCount: s.int(),
    }),
    output: s.boolean(),
  });
  const NativeFormData = FormData;
  let quantity = "";
  let requiredCount = "1";
  const validity = { badInput: false };
  class FieldsFormData extends NativeFormData {
    constructor() {
      super();
      this.set("checked", "on");
      this.set("quantity", quantity);
      this.set("contact", " ");
      this.set("note", "");
      this.set("requiredCount", requiredCount);
    }
  }
  const requests: unknown[] = [];
  const save = mutation(write, {
    resetOnSuccess: false,
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true, value: true });
    },
  });
  globalThis.FormData = FieldsFormData;
  try {
    const checkbox = (name: "checked" | "unchecked" | "disabled", checked: boolean, disabled = false) => ({
      ...save.field(name).input,
      localName: "input",
      checked,
      matches: (selector: string) => selector === ":disabled" && disabled,
    });
    const unchecked = checkbox("unchecked", false);
    assert.equal(unchecked.type, "checkbox");
    assert.equal(unchecked.required, undefined);
    const form = {
      elements: [
        checkbox("checked", true),
        unchecked,
        checkbox("disabled", true, true),
        checkbox("checked", false, true),
        { localName: "input", name: "quantity", validity, matches: () => false },
      ],
    } as unknown as HTMLFormElement;
    const result = await save.submitForm!(form, { trace: { traceId: "checkbox-submit" } });
    assert.equal(result.ok, true);
    const expected = { checked: true, unchecked: false, note: "", requiredCount: 1 };
    assert.deepEqual(requests, [expected]);

    validity.badInput = true;
    await assert.rejects(save.submitForm!(form, { trace: { traceId: "bad-number" } }));
    assert.equal(save.invalid("quantity"), true);
    validity.badInput = false;

    quantity = "0";
    await save.submitForm!(form, { trace: { traceId: "zero-number" } });
    assert.deepEqual(requests, [expected, { ...expected, quantity: 0 }]);

    requiredCount = "";
    await assert.rejects(save.submitForm!(form, { trace: { traceId: "blank-required-number" } }));
    assert.equal(save.invalid("requiredCount"), true);
    assert.equal(requests.length, 2);
  } finally {
    globalThis.FormData = NativeFormData;
    save.dispose();
  }
});

test("mutations can keep bound form values after a successful response", async () => {
  const write = operationContract({
    id: "draft.write",
    input: s.object({ title: s.string() }),
    output: s.string(),
  });
  for (const resetOnSuccess of [undefined, false]) {
    const save = mutation(write, {
      fields: { title: "" },
      resetOnSuccess,
      fetch: async () => Response.json({ ok: true, value: "Updated" }),
    });
    try {
      save.fields.title.set("Updated");
      assert.equal((await save.execute()).ok, true);
      assert.equal(save.fields.title(), resetOnSuccess === false ? "Updated" : "");
    } finally {
      save.dispose();
    }
  }
});

test("bound mutation inputs share keyed requests and outcomes", async () => {
  const write = operationContract({
    id: "row.write",
    expose: { web: true },
    input: s.object({ id: s.string() }),
    output: s.string(),
    errors: { CONFLICT: 409 },
  });
  const save = mutation(write, {
    key: "id",
    fetch: async (_url, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), { id: "first" });
      return Response.json(
        { ok: false, kind: "business_error", error: "CONFLICT" },
        { status: 409 },
      );
    },
  });
  try {
    const first = save.for("first");
    const control = view({
      id: "row.control",
      template: () => jsx("div", {
        children: [
          jsx("button", { onClick: first.run }),
          jsx("button", { onClick: reactiveEvent(() => first.run(), () => first) }),
          jsx("button", { onClick: reactiveEvent(() => save.run({ id: "first" }), () => save) }),
        ],
      }),
    });
    assert.equal(compileArchitecture([control]).edges.filter(({ from, to, kind }) =>
      from.endsWith(".on:click") && to === save.id && kind === "TRIGGERS",
    ).length, 3);
    const same = save.for({ id: "first" });
    const other = save.for({ id: "other" });
    const request = first.run();
    assert.equal(same.run(), request);
    assert.equal(save.run({ id: "first" }), request);
    assert.equal(same.pending(), true);
    assert.equal(other.pending(), false);
    const result = await request;
    assert.equal(first.pending(), false);
    assert.equal(same.outcome()?.result, result);
    assert.equal(same.failed("CONFLICT"), true);
    assert.equal(other.outcome(), undefined);
  } finally {
    save.dispose();
  }
});

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
