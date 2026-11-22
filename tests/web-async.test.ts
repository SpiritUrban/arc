import { test } from "node:test";
import assert from "node:assert/strict";
import type { BrowserEvent } from "../framework/src/neutral/protocol.ts";
import {
  action,
  captureResourceUpdate,
  state,
  derive,
  webResource,
  tick,
  webApplication,
} from "../framework/src/web/index.ts";
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
test("action auto execution state, typed input and batched mutations", async () => {
  const a = state({ id: "a", initial: 0 }),
    b = state({ id: "b", initial: 0 });
  let calls = 0;
  const sum = derive({
    id: "sum",
    from: [a, b],
    compute: (a, b) => {
      calls++;
      return a + b;
    },
  });
  const go = action({
    id: "go",
    needs: { a, b },
    run() {
      a.set(3);
      b.set(4);
      return 7;
    },
  });
  assert.equal(go.running.get(), false);
  const task = go.execute(undefined);
  await tick();
  assert.equal(await task, 7);
  assert.equal(go.get().status, "success");
  assert.equal(sum.get(), 7);
  assert.equal(calls, 2);
  go.dispose();
  sum.dispose();
  a.dispose();
  b.dispose();
});
test("web resource race guards stale completions even if underlying load ignores abort", async () => {
  const id = state({ id: "id", initial: "a" });
  const first = deferred<string>(),
    second = deferred<string>();
  const signals: AbortSignal[] = [];
  const resource = webResource({
    id: "remote",
    from: [id],
    input: (id) => id,
    load: async (input, { signal }) => {
      signals.push(signal);
      return input === "a" ? first.promise : second.promise;
    },
  });
  resource.activate();
  assert.equal(resource.loading.get(), true);
  id.set("b");
  await tick();
  assert.equal(signals[0].aborted, true);
  second.resolve("B");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(resource.data.get(), "B");
  first.resolve("A");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(resource.data.get(), "B");
  resource.dispose();
  assert.equal(signals[1].aborted, true);
  assert.equal(id._listeners.size, 0);
  id.dispose();
});
test("keyed resources immediately hide another key's snapshot and ignore late responses", async () => {
  const owner = state({ id: "keyed.owner", initial: "a" });
  const responses: ReturnType<typeof deferred<string | Error>>[] = [];
  const resource = webResource({
    id: "keyed.orders",
    callable: true,
    from: [owner],
    key: () => owner.get(),
    async load() {
      const response = deferred<string | Error>();
      responses.push(response);
      const result = await response.promise;
      if (result instanceof Error) throw result;
      return result;
    },
  });
  resource.activate();
  responses[0].resolve("A");
  await tick();
  assert.equal(resource().data, "A");

  const failed = resource.refresh();
  responses[1].resolve(new Error("A failed"));
  await failed;
  assert.equal(resource().data, "A");
  assert.ok(resource.error.get());

  const stalled = resource.refresh();
  owner.set("b");
  assert.equal(resource().data, undefined);
  assert.equal(resource.data.get(), undefined);
  assert.equal(resource().error, undefined);
  assert.equal(resource.loading.get(), true);
  await tick();
  responses[3].resolve("B");
  await tick();
  responses[2].resolve("late A");
  await stalled;
  assert.equal(resource().data, "B");
  assert.equal(resource.data.get(), "B");

  const failedAfterSwitch = resource.refresh();
  responses[4].resolve(new Error("B failed"));
  await failedAfterSwitch;
  assert.ok(resource.error.get());
  owner.set("a");
  assert.equal(resource.error.get(), undefined);
  assert.equal(resource().data, undefined);
  await tick();
  responses[5].resolve("fresh A");
  await tick();
  assert.equal(resource().data, "fresh A");
  resource.dispose();
  owner.dispose();
});

test("a confirmed resource update survives an older refresh", async () => {
  const initial = [{ id: "first", cancelled: false }];
  const delayed = deferred<typeof initial>();
  let reads = 0;
  const resource = webResource({
    id: "confirmed.orders",
    load: async () => reads++ ? delayed.promise : initial,
  });
  await resource.refresh();
  const refresh = resource.refresh();
  resource[captureResourceUpdate]!()(
    (orders) => orders.map((order) =>
      order.id === "first" ? { ...order, cancelled: true } : order,
    ),
    { traceId: "cancel-order" },
  );
  assert.equal(resource.data.get()?.[0].cancelled, true);
  delayed.resolve([...initial, { id: "unrelated", cancelled: false }]);
  await refresh;
  assert.deepEqual(resource.data.get(), [
    { id: "first", cancelled: true },
    { id: "unrelated", cancelled: false },
  ]);
  resource.dispose();
});

test("resource update telemetry reports materialized changes under the mutation trace", async () => {
  const events: BrowserEvent[] = [];
  const loadInitial = deferred<number>();
  let key = "first";
  const resource = webResource({
    id: "orders",
    key: () => key,
    cache: true,
    load: () => key === "first" ? loadInitial.promise : Promise.resolve(20),
  });
  const changes = () => events.filter((event) => event.type === "resource.updated");
  const trace = { traceId: "mutation", parentId: "action" };
  try {
    resource.activate({ emit: (event) => events.push(event) });
    const refresh = resource.refresh();
    const updateFirst = resource[captureResourceUpdate]!();
    updateFirst((value) => value + 1, trace);
    assert.deepEqual(changes(), []);
    loadInitial.resolve(10);
    await refresh;
    assert.equal(resource.data.get(), 11);
    assert.deepEqual(changes().map((event) => event.data), [
      { snapshot: true, cache: true, replayed: true },
    ]);
    key = "second";
    await resource.refresh();
    updateFirst((value) => value + 1, trace);
    updateFirst((value) => value, trace);
    assert.equal(resource.data.get(), 20);
    assert.deepEqual(changes().map((event) => [event.traceId, event.parentId, event.data]), [
      ["mutation", "action", { snapshot: true, cache: true, replayed: true }],
      ["mutation", "action", { snapshot: false, cache: true }],
    ]);
  } finally {
    resource.dispose();
  }
});

test("resource errors, invalidation after success, activation and dispose ownership", async () => {
  let loads = 0;
  const r = webResource({ id: "r", load: async () => ++loads });
  const go = action({
    id: "mutation",
    invalidates: [r],
    run: () => ({ ok: true as const, value: 1 }),
  });
  const app = webApplication({ nodes: [go, r] });
  assert.ok(app.compile().edges.some((e) => e.kind === "INVALIDATES"));
  app.start();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(r.data.get(), 1);
  await go.execute(undefined);
  assert.equal(r.data.get(), 2);
  app.dispose();
  const broken = webResource({
    id: "broken",
    load: async () => {
      throw Error("external");
    },
  });
  await broken.refresh();
  assert.equal(broken.get().outcome, "fault");
  assert.ok(broken.error.get());
  broken.dispose();
});

test("view-owned resource starts on mount and aborts on unmount", async () => {
  const { parseHTML } = await import("linkedom");
  const { view, binding } = await import("../framework/src/web/index.ts");
  let signal: AbortSignal | undefined;
  const pending = deferred<string>();
  const resource = webResource({
    id: "owned",
    scope: "view",
    load: async (_, { signal: s }) => {
      signal = s;
      return pending.promise;
    },
  });
  const text = binding({
    id: "owned.text",
    type: "text",
    sources: [resource.data],
  });
  const page = view({
    id: "owned.page",
    owned: [resource],
    bindings: [text],
    setup({ document, bind }) {
      const node = document.createElement("p");
      bind(text, node);
      return node;
    },
  });
  const app = webApplication({ nodes: [page] });
  app.compile();
  app.start();
  assert.equal(signal, undefined);
  const { document } = parseHTML('<div id="app"></div>');
  const instance = app.mount(
    page,
    document.querySelector("#app")! as unknown as Element,
  );
  assert.equal(signal!.aborted, false);
  instance.unmount();
  assert.equal(signal!.aborted, true);
  pending.resolve("late");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(document.querySelector("p"), null);
  app.dispose();
});

test("resource input failure is observable and does not reject activation", async () => {
  const r = webResource({
    id: "input.failure",
    input() {
      throw Error("bad input");
    },
    load: async () => 1,
  });
  await r.refresh();
  assert.equal(r.get().outcome, "fault");
  assert.match(String(r.error.get()), /bad input/);
  r.dispose();
});
