import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { build } from "esbuild";
import { parseHTML } from "linkedom";
import { importApplication } from "../framework/src/fullstack/reactive-jsx.ts";
import { buildWeb, staticWeb } from "../framework/src/fullstack/build.ts";
import { internalTransport } from "../framework/src/fullstack/server.ts";
import { serve, closeServer, handler } from "../framework/src/http.ts";
import { stand } from "../framework/src/stand.ts";

async function workspaceScript(outDir: string) {
  // Inline split chunks so this DOM harness can execute the built router.
  const { outputFiles } = await build({
    entryPoints: [join(outDir, "app.js")],
    bundle: true,
    format: "iife",
    write: false,
  });
  return new vm.Script(outputFiles[0]!.text);
}

function browserWindow(window: ReturnType<typeof parseHTML>["window"], location: URL) {
  return {
    location,
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
  };
}

test("Workspace order edit carries the submit trace to the server operation in Stand", async () => {
  const entry = new URL("../examples/workspace/app.ts", import.meta.url);
  const { createApp } = await importApplication(entry) as typeof import("../examples/workspace/app.ts");
  const { CreateOrder } = await import("../examples/workspace/orders/contracts.ts");
  const app = createApp();
  const dir = await mkdtemp(join(tmpdir(), "arc-workspace-trace-"));
  const { document, window } = parseHTML('<html><head></head><body><div id="app"></div></body></html>');
  try {
    await app.compile({ entry });
    const bundle = await buildWeb(app, { outDir: dir });
    const script = await workspaceScript(bundle.outDir);
    await app.start();
    const transport = internalTransport(app);
    const created = await transport(new Request(`http://localhost/_arc/call/${CreateOrder.id}`, {
      method: "POST",
      headers: {
        authorization: "Bearer 00000000-0000-4000-8000-000000000001",
        "content-type": "application/json",
      },
      body: JSON.stringify({ product: "Notebook", quantity: 2 }),
    }));
    assert.equal(created.status, 200);
    const { value: { id } } = await created.json();
    const location = new URL(`http://localhost/orders/${id}`);
    let editTrace: string | null = null;
    const fetcher: typeof fetch = (input, init) => {
      const request = new Request(new URL(String(input), location), init);
      if (new URL(request.url).pathname === "/_arc/call/orders.update")
        editTrace = request.headers.get("x-arc-trace-id");
      return transport(request);
    };
    class BrowserFormData extends FormData {
      constructor(form: HTMLFormElement) {
        super();
        for (const field of form.querySelectorAll<HTMLInputElement>("input[name]"))
          this.append(field.name, field.value);
      }
    }
    script.runInNewContext({
      document,
      window: browserWindow(window, location),
      fetch: fetcher,
      crypto, URL, Request, Response, Headers, FormData: BrowserFormData,
      AbortController, performance, queueMicrotask, setTimeout, clearTimeout, console,
    });
    const waitFor = async (predicate: () => boolean, description: string) => {
      for (let i = 0; i < 200 && !predicate(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.ok(predicate(), description);
    };
    await waitFor(() => !!document.querySelector("[data-edit-order]"), "order form mounted");
    await waitFor(() => app.browserEvents.some((event) =>
      event.node === "orders.list.query" && event.type === "resource.finished" && event.outcome === "ok"),
    "order list snapshot loaded");
    const form = document.querySelector("[data-edit-order]")!;
    const fields = [...form.querySelectorAll<HTMLInputElement>("input[name]")];
    Object.defineProperty(form, "elements", { value: fields });
    form.querySelector<HTMLInputElement>('input[name="product"]')!.value = "Revised notebook";
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => document.querySelector("[data-order-detail] h2")?.textContent === "Revised notebook",
      "detail updated from the mutation response");
    assert.ok(editTrace);
    const mutationEvents = [
      ["binding.event", "page:pages/orders/[id].dom."],
      ["action.started", "orders.update.submit"],
      ["remote.started", "orders.update.submit.remote"],
      ["remote.finished", "orders.update.submit.remote"],
      ["resource.updated", "orders.get.query"],
      ["resource.updated", "orders.list.query"],
      ["action.finished", "orders.update.submit"],
    ] as const;
    await waitFor(() => mutationEvents.every(([type, node]) => app.browserEvents.some((event) =>
      event.traceId === editTrace && event.type === type &&
      (type === "binding.event" ? event.node.startsWith(node) : event.node === node))),
    "form, mutation and remote events share the server trace");
    const live = await (await stand(app)(new Request("http://localhost/api/live"))).json();
    const interaction = live.interactions.find(({ traceId }: { traceId: string }) => traceId === editTrace);
    assert.ok(interaction);
    assert.deepEqual(interaction.server.map(({ operation }: { operation: string }) => operation), ["orders.update"]);
    const started = interaction.browser.find((event: (typeof app.browserEvents)[number]) =>
      event.type === "action.started" && event.node === "orders.update.submit");
    const remote = interaction.browser.find((event: (typeof app.browserEvents)[number]) =>
      event.type === "remote.started" && event.node === "orders.update.submit.remote");
    assert.ok(started?.spanId);
    assert.equal(remote?.parentId, started.spanId);
    const updates = interaction.browser.filter((event: (typeof app.browserEvents)[number]) =>
      event.type === "resource.updated");
    assert.deepEqual(updates.map((event: (typeof app.browserEvents)[number]) =>
      [event.node, event.parentId]).sort(), [
      ["orders.get.query", started.spanId],
      ["orders.list.query", started.spanId],
    ]);
    const outletIds = ["router-outlet:root", "router-outlet:/", "router-outlet:/orders"];
    for (const id of outletIds) {
      assert.ok(bundle.manifest.partitions?.browser.includes(id));
      assert.ok(bundle.manifest.partitions?.browser.includes(`${id}.dom.0.0.render`));
    }
    const readLive = async () =>
      (await stand(app)(new Request("http://localhost/api/live"))).json() as Promise<{
        browserEvents: typeof app.browserEvents;
      }>;
    const mounted = await readLive();
    for (const id of outletIds) {
      assert.ok(mounted.browserEvents.some((event) => event.node === id && event.type === "view.mounted"), id);
    }
    window.dispatchEvent(new window.Event("pagehide"));
    await waitFor(() => outletIds.every((id) => app.browserEvents.some((event) =>
      event.node === id && event.type === "view.unmounted")),
    "router outlet unmount telemetry reached Stand");
    const unmounted = await readLive();
    for (const id of outletIds) {
      assert.ok(unmounted.browserEvents.some((event) => event.node === id && event.type === "view.unmounted"), id);
    }
  } finally {
    window.dispatchEvent(new window.Event("pagehide"));
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Workspace order update has consistent identities and impact in build and Stand", async () => {
  const entry = new URL("../examples/workspace/app.ts", import.meta.url);
  const { createApp } = await importApplication(entry) as typeof import("../examples/workspace/app.ts");
  const app = createApp();
  const dir = await mkdtemp(join(tmpdir(), "arc-workspace-graph-"));
  try {
    await app.compile({ entry });
    const graph = app.graph();
    const { manifest } = await buildWeb(app, { outDir: dir });
    const response = await stand(app)(new Request("http://localhost/api/graph"));
    assert.equal(response.status, 200);
    const standGraph = await response.json();
    const artifact = JSON.parse(await readFile(join(dir, "architecture.json"), "utf8"));
    assert.deepEqual(artifact, standGraph);
    const mutation = "orders.update.submit";
    const operation = "orders.update";
    for (const id of ["orders.get.query", mutation, "orders.detail-cancel.submit"]) {
      assert.equal(graph.nodes.find((node) => node.id === id)?.scope, "view", id);
    }
    assert.ok(manifest.partitions?.browser.includes(mutation));
    assert.ok(manifest.partitions?.server.includes(operation));
    assert.ok(manifest.boundaries?.some(({ from, to }) =>
      from === `${mutation}.remote` && to === operation
    ));
    const affected = graph.analysis?.nodes.find(({ id }) => id === operation)?.affectedNodes;
    assert.equal(graph.edges.filter(({ from, to, kind }) =>
      from === "orders.create.submit" && to.endsWith(".aria-invalid") && kind === "BINDS",
    ).length, 2);
    assert.ok(graph.edges.some(({ from, to, kind }) =>
      from === mutation && to.startsWith("page:pages/orders/[id].dom.") && kind === "BINDS",
    ));
    assert.ok(affected);
    for (const consumer of [mutation, "http:PUT:/orders/:id", "orders.get.query", "orders.list.query"]) {
      assert.ok(affected.includes(consumer), consumer);
    }
    assert.ok(!affected.includes(operation));
    assert.ok(!affected.includes("users.update.submit"));
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Workspace browser creates users/orders, handles business errors and isolates selected user data", async () => {
  const entry = new URL("../examples/workspace/app.ts", import.meta.url);
  const { createApp } = await importApplication(entry) as typeof import("../examples/workspace/app.ts");
  const app = createApp();
  const dir = await mkdtemp(join(tmpdir(), "arc-workspace-"));
  let server: Awaited<ReturnType<typeof serve>> | undefined;
  let cleanupBrowser: (() => void) | undefined;
  const pending = new Set<Promise<any>>();
  const heldRequests = new Map<string, Promise<void>>();
  const releaseRequests: (() => void)[] = [];
  function holdRequest(path: string) {
    let release!: () => void;
    heldRequests.set(path, new Promise<void>((resolve) => { release = resolve; }));
    releaseRequests.push(release);
    return () => {
      heldRequests.delete(path);
      release();
    };
  }
  const releaseCancellations = new Map<string, () => void>();
  let returningOrders: { owner: string; wait: Promise<void>; release(): void } | undefined;
  try {
    await app.compile({ entry });
    const { edges, nodes } = app.graph();
    assert.ok(nodes.some(({ id }) => id.startsWith("users.page.dom.") && id.endsWith(".each")));
    assert.equal(nodes.find(({ id }) => id === "orders.page.history")?.scope, "view");
    assert.ok(edges.some(({ from, to, kind }) =>
      from === "orders.page.history" && to.startsWith("orders.page.dom.") &&
      to.endsWith(".each") && kind === "BINDS",
    ));
    assert.equal(
      edges.filter((edge) =>
        edge.to.startsWith("orders.page.dom.") &&
        edge.to.endsWith(".render") &&
        edge.from === "orders.visible" &&
        edge.kind === "BINDS",
      ).length,
      2,
    );
    assert.ok(edges.some((e) =>
      e.from === "orders.create.submit.remote" && e.to === "orders.create" && e.kind === "REMOTE_CALLS",
    ));
    assert.ok(edges.some((e) =>
      e.from === "orders.create.submit" && e.to === "orders.list.query" && e.kind === "UPDATES",
    ));
    assert.ok(edges.some((e) =>
      e.from === "orders.cancel.submit" && e.to === "orders.list.query" && e.kind === "UPDATES",
    ));
    assert.ok(edges.some((e) =>
      e.from === "users.create.submit" && e.to === "users.list.query" && e.kind === "INVALIDATES",
    ));
    assert.ok(edges.some((e) =>
      e.from === "users.list.query" && e.to === "users.list" && e.kind === "REMOTE_CALLS",
    ));
    for (const from of ["users.list.query.loading", "users.list.query.data"]) {
      assert.ok(edges.some((edge) =>
        edge.from === from &&
        edge.to.startsWith("users.page.dom.") &&
        edge.to.endsWith(".render") &&
        edge.kind === "BINDS",
      ), from);
    }
    for (const from of ["orders.list.query", "orders.create.submit"]) {
      assert.ok(edges.some((edge) =>
        edge.from === from &&
        edge.to === "workspace.selected-user" &&
        edge.kind === "DEPENDS_ON",
      ));
    }
    await app.start();
    const built = await buildWeb(app, { outDir: dir });
    assert.ok(nodes.some(({ id }) => id === "page:pages/orders/index"));
    assert.ok(nodes.some(({ id }) => id === "page:pages/orders/[id]"));
    for (const route of ["/", "/orders", "/orders/:id"]) {
      assert.ok(edges.some(({ from, kind }) => from === `layout:${route}` && kind === "DEPENDS_ON"));
    }
    assert.ok(built.manifest.inputs.includes("examples/workspace/pages/index.tsx"));
    assert.ok(built.manifest.inputs.includes("examples/workspace/pages/layout.tsx"));
    assert.ok(built.manifest.inputs.some((input) => input.endsWith("arc-router-entry.js")));
    assert.ok(!built.manifest.inputs.includes("examples/workspace/users/server.ts"));
    assert.ok(!built.manifest.inputs.includes("examples/workspace/orders/server.ts"));
    assert.ok(!built.manifest.inputs.includes("examples/workspace/auth.ts"));
    const remote = internalTransport(app);
    const rest = handler(app);
    server = await serve(async (request) => {
      if (new URL(request.url).pathname.startsWith("/_arc/")) return remote(request);
      return (await staticWeb(built.outDir, request, built.pages)) ?? rest(request);
    }, { port: 0 });
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const ordersPage = await fetch(`${origin}/orders`, { headers: { accept: "text/html" } });
    assert.equal(ordersPage.status, 200);
    assert.match(ordersPage.headers.get("content-type")!, /text\/html/);
    const { document: ordersDocument, window: ordersWindow } = parseHTML(await ordersPage.text());
    const ordersScript = ordersDocument.querySelector("script")!.getAttribute("src")!;
    assert.equal(ordersScript, "/app.js");
    const asset = await fetch(`${origin}${ordersScript}`);
    assert.equal(asset.status, 200);
    assert.match(await asset.text(), /import\(/);
    const script = await workspaceScript(built.outDir);
    const orderApi = await fetch(`${origin}/orders`, {
      headers: { accept: "application/json", authorization: "Bearer 00000000-0000-4000-8000-000000000001" },
    });
    assert.equal(orderApi.status, 200);
    assert.deepEqual(await orderApi.json(), []);
    assert.equal((await fetch(`${origin}/unknown-page`, { headers: { accept: "text/html" } })).status, 404);
    const { window, document } = parseHTML(
      '<html><head></head><body><div id="app"></div></body></html>',
    );
    let createOrderRequests = 0;
    let cancelOrderRequests = 0;
    let listOrderRequests = 0;
    const fetcher: typeof fetch = (input, init) => {
      const url = new URL(String(input), origin);
      if (url.pathname === "/_arc/call/orders.create") createOrderRequests++;
      if (url.pathname === "/_arc/call/orders.list") listOrderRequests++;
      let ready = heldRequests.get(url.pathname) ?? Promise.resolve();
      if (url.pathname === "/_arc/call/orders.list" &&
          returningOrders && new Headers(init?.headers).get("authorization") === `Bearer ${returningOrders.owner}`) {
        ready = returningOrders.wait;
      }
      if (url.pathname === "/_arc/call/orders.cancel") {
        cancelOrderRequests++;
        const { id } = JSON.parse(String(init?.body));
        const previous = releaseCancellations.get(id);
        ready = new Promise<void>((resolve) => {
          releaseCancellations.set(id, () => {
            previous?.();
            resolve();
          });
        });
      }
      const promise = ready.then(() => fetch(url, init));
      pending.add(promise);
      void promise.finally(() => pending.delete(promise)).catch(() => {});
      return promise;
    };
    // LinkeDOM has no form-aware FormData constructor.
    class BrowserFormData extends FormData {
      constructor(form: HTMLFormElement) {
        super();
        for (const field of form.querySelectorAll<HTMLInputElement>("input[name]")) {
          this.append(field.name, field.value);
        }
      }
    }
    const browserGlobals = {
      crypto: globalThis.crypto,
      fetch: fetcher,
      Request,
      Response,
      Headers,
      FormData: BrowserFormData,
      URL,
      AbortController,
      performance,
      queueMicrotask,
      setTimeout,
      clearTimeout,
      console,
    };
    const waitFor = async (predicate: () => boolean, description = "Workspace interaction did not settle") => {
      for (let i = 0; i < 200 && !predicate(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.ok(predicate(), description);
    };
    script.runInNewContext({
      ...browserGlobals,
      window: browserWindow(ordersWindow, new URL(`${origin}/orders`)),
      document: ordersDocument,
    });
    await waitFor(() => !!ordersDocument.querySelector("#app h1"), "orders route mounted");
    assert.equal(ordersDocument.title, "Замовлення — ARC Workspace");
    assert.equal(ordersDocument.querySelector("#app h1")!.textContent, "Замовлення");
    assert.ok(ordersDocument.querySelector('#app a[href="/"][aria-label="ARC Workspace"]'));
    assert.ok(ordersDocument.querySelector('#app nav a[href="/orders"][aria-current="page"]'));
    assert.ok(ordersDocument.head.querySelector("style")?.textContent?.includes(".workspace"));
    ordersWindow.dispatchEvent(new ordersWindow.Event("pagehide"));
    script.runInNewContext({
      ...browserGlobals, window: browserWindow(window, new URL(origin)), document,
    });
    cleanupBrowser = () => window.dispatchEvent(new window.Event("pagehide"));
    await waitFor(() => !!document.querySelector("#app nav"), "workspace route mounted");
    assert.match(document.title, /ARC Workspace/);
    assert.ok(document.querySelector('#app nav a[href="/"][aria-current="page"]'));
    assert.ok(document.head.querySelector("style")?.textContent?.includes(".workspace"));
    const input = (selector: string, value: string) => {
      const field = document.querySelector(
        selector,
      )! as unknown as HTMLInputElement;
      field.value = value;
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    };
    const submit = (selector: string) =>
      document
        .querySelector(selector)!
        .dispatchEvent(
          new window.Event("submit", { bubbles: true, cancelable: true }),
        );
    await waitFor(() => document.querySelectorAll("[data-user]").length === 1);
    assert.match(
      document.querySelector("[data-user]")!.textContent!,
      /Demo User/,
    );
    function formFields(selector: string) {
      const form = document.querySelector(selector)!;
      const fields = Array.from(form.querySelectorAll<HTMLInputElement>("input[name]"));
      Object.defineProperty(form, "elements", { value: fields });
      for (const field of fields) {
        Object.defineProperties(field, {
          form: { value: form },
          defaultValue: { value: "" },
        });
      }
      return fields;
    }
    const userFields = formFields("#users form");
    formFields("#orders form");
    input("[data-name]", "x");
    input("[data-email]", "new@example.com");
    submit("#users form");
    await waitFor(() =>
      document.querySelector("#users [data-error]")!.textContent!.includes("Перевірте введені дані"),
    );
    assert.equal(userFields[0].value, "x");
    assert.equal(document.querySelectorAll("[data-user]").length, 1);
    input("[data-name]", "<New User>");
    input("[data-email]", "new@example.com");
    const addButton = document.querySelector<HTMLButtonElement>("#users button[type=submit]")!;
    const releaseUser = holdRequest("/_arc/call/users.create");
    submit("#users form");
    await waitFor(() => addButton.disabled, "add user button disabled while submitting");
    releaseUser();
    await waitFor(() => document.querySelectorAll("[data-user]").length === 2);
    assert.equal(addButton.disabled, false);
    assert.match(document.querySelector("#users [data-status]")!.textContent!, /^2 /);
    assert.deepEqual(userFields.map((field) => field.value), ["", ""]);
    await waitFor(() =>
      document
        .querySelector('[data-user][aria-pressed="true"]')!
        .textContent!.includes("<New User>"),
    );
    assert.equal(
      document.querySelector('[data-user][aria-pressed="true"]')!.querySelector("new"),
      null,
      "user markup must be escaped",
    );
    await waitFor(
      () => document.querySelector("[data-loading]")!.textContent === "",
      "order list finished loading for the selected user",
    );
    input("[data-product]", "  ARC Notebook  ");
    input("[data-quantity]", "3");
    await waitFor(() => document.querySelector("[data-preview]")!.textContent!.includes("75"));
    const orderButton = document.querySelector<HTMLButtonElement>("#orders button[type=submit]")!;
    const releaseOrder = holdRequest("/_arc/call/orders.create");
    const readsBeforeCreate = listOrderRequests;
    submit("#orders form");
    await waitFor(() => orderButton.disabled, "create order button disabled while submitting");
    releaseOrder();
    await waitFor(() =>
      document
        .querySelector("[data-rows]")!
        .textContent!.includes("ARC Notebook"),
    );
    assert.equal(orderButton.disabled, false);
    assert.equal(listOrderRequests, readsBeforeCreate);
    assert.match(document.querySelector("[data-amount]")!.textContent!, /75/);
    assert.equal(document.querySelector("[data-count]")!.textContent, "01");
    assert.equal(
      document.querySelector("[data-rows] strong")!.textContent,
      "ARC Notebook",
    );
    const userId = document.querySelector('[data-user][aria-pressed="true"]')!.getAttribute("data-user");
    const ordersResponse = await handler(app)(
      new Request("http://localhost/orders", {
        headers: { authorization: `Bearer ${userId}` },
      }),
    );
    assert.equal(ordersResponse.status, 200);
    assert.match(await ordersResponse.text(), /ARC Notebook/);
    assert.equal(
      (document.querySelector("[data-product]")! as unknown as HTMLInputElement)
        .value,
      "",
    );
    const quantity = document.querySelector<HTMLInputElement>("[data-quantity]")!;
    assert.equal(quantity.value, "1");
    assert.match(document.querySelector("[data-preview]")!.textContent!, /25/);
    input("[data-product]", "Rejected product");
    input("[data-quantity]", "0");
    submit("#orders form");
    await waitFor(() =>
      document.querySelector("[data-quantity-error]")!.textContent!.includes("від 1 до 100"),
    );
    assert.equal(quantity.getAttribute("aria-invalid"), "true");
    assert.equal(quantity.value, "0");
    assert.equal(createOrderRequests, 1);
    assert.equal(
      document.querySelector<HTMLInputElement>("[data-product]")!.value,
      "Rejected product",
    );
    assert.equal(document.querySelectorAll("[data-rows] tr").length, 1);
    input("[data-product]", "");
    input("[data-quantity]", "2");
    submit("#orders form");
    await waitFor(() =>
      document.querySelector("[data-product-error]")!.textContent!.includes("Вкажіть назву товару"),
    );
    assert.equal(quantity.getAttribute("aria-invalid"), "false");
    assert.equal(document.querySelector("[data-quantity-error]")!.textContent, "");
    assert.equal(createOrderRequests, 1);
    input("[data-name]", "Duplicate User");
    input("[data-email]", "new@example.com");
    submit("#users form");
    await waitFor(() =>
      document
        .querySelector("#users [data-email-error]")!
        .textContent!.includes("вже існує"),
    );
    assert.equal(document.querySelector("[data-email]")!.getAttribute("aria-invalid"), "true");
    assert.equal(document.querySelector("#users [data-error]")!.textContent, "");
    assert.equal(
      document.querySelector<HTMLInputElement>("[data-name]")!.value,
      "Duplicate User",
    );
    assert.match(
      document.querySelector('[data-user][aria-pressed="true"]')!.textContent!,
      /New User/,
    );
    input("[data-name]", "x");
    submit("#users form");
    await waitFor(() =>
      document.querySelector("#users [data-error]")!.textContent!.includes("Перевірте введені дані"),
    );
    assert.equal(document.querySelector("[data-email]")!.getAttribute("aria-invalid"), "false");
    assert.equal(document.querySelector("#users [data-email-error]")!.textContent, "");
    assert.equal(document.querySelectorAll("[data-user]").length, 2);
    const newUserRow = document.querySelector('[data-user][aria-pressed="true"]')!;
    const demoUserRow = document.querySelector(
      '[data-user="00000000-0000-4000-8000-000000000001"]',
    )!;
    demoUserRow.dispatchEvent(new window.Event("click", { bubbles: true }));
    await waitFor(() =>
      document
        .querySelector('[data-user][aria-pressed="true"]')!
        .textContent!.includes("Demo User"),
    );
    assert.equal(document.querySelector('[data-user][aria-pressed="true"]'), demoUserRow);
    assert.equal(demoUserRow.getAttribute("aria-pressed"), "true");
    assert.equal(newUserRow.getAttribute("aria-pressed"), "false");
    await waitFor(
      () =>
        document.querySelector("[data-rows]")!.textContent === "" &&
        document.querySelector("[data-loading]")!.textContent === "",
    );
    assert.match(document.querySelector("[data-amount]")!.textContent!, /0/);
    assert.equal(document.querySelector("[data-count]")!.textContent, "00");
    input("[data-search]", "new@example.com");
    await waitFor(() => document.querySelectorAll("[data-user]").length === 1);
    assert.equal(document.querySelector("[data-user]"), newUserRow);
    const createdWhileAway = await handler(app)(
      new Request("http://localhost/orders", {
        method: "POST",
        headers: {
          authorization: `Bearer ${userId}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ product: "Added while away", quantity: 2 }),
      }),
    );
    assert.equal(createdWhileAway.status, 201);
    let releaseOrders!: () => void;
    returningOrders = {
      owner: userId!,
      wait: new Promise<void>((resolve) => { releaseOrders = resolve; }),
      release: releaseOrders,
    };
    document
      .querySelector("[data-user]")!
      .dispatchEvent(new window.Event("click", { bubbles: true }));
    await waitFor(() =>
      document
        .querySelector("[data-rows]")!
        .textContent!.includes("ARC Notebook"),
    );
    assert.equal(document.querySelectorAll("[data-order]").length, 1);
    assert.match(document.querySelector("[data-loading]")!.textContent!, /Завантажуємо/);
    returningOrders.release();
    returningOrders = undefined;
    await waitFor(() =>
      document.querySelector("[data-rows]")!.textContent!.includes("Added while away"),
    );
    await waitFor(() =>
      app.browserEvents.some(
        (e) => e.node === "orders.create.submit" && e.type === "action.finished",
      ),
    );
    const trace = app.browserEvents.find(
      (e) => e.node === "orders.create.submit" && e.type === "action.started",
    )!;
    assert.ok(
      app.traces.some(
        (t) => t.operation === "orders.create" && t.id === trace.traceId,
      ),
    );
    const [firstRow, secondRow] = document.querySelectorAll("[data-order]");
    const orderId = firstRow.getAttribute("data-order")!;
    const secondId = secondRow.getAttribute("data-order")!;
    const cancelOverRest = (actor: string, id = orderId) => handler(app)(
      new Request("http://localhost/orders/cancel", {
        method: "POST",
        headers: {
          authorization: `Bearer ${actor}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id }),
      }),
    );
    const denied = await cancelOverRest("00000000-0000-4000-8000-000000000001");
    assert.equal(denied.status, 404);
    assert.match(await denied.text(), /ORDER_NOT_FOUND/);
    const firstButton = firstRow.querySelector<HTMLButtonElement>("[data-cancel-order]")!;
    const secondButton = secondRow.querySelector<HTMLButtonElement>("[data-cancel-order]")!;
    const click = (button: HTMLButtonElement) =>
      button.dispatchEvent(new window.Event("click"));
    click(firstButton);
    click(firstButton);
    await waitFor(() => firstButton.disabled && releaseCancellations.has(orderId));
    assert.match(firstButton.textContent!, /Скасовуємо/);
    assert.equal(secondButton.disabled, false);
    assert.equal(cancelOrderRequests, 1);
    click(secondButton);
    await waitFor(() => secondButton.disabled && releaseCancellations.has(secondId));
    assert.equal(cancelOrderRequests, 2);
    const status = (id: string) => document.querySelector(`[data-order="${id}"] .order-status`)!.textContent;
    const rowError = (id: string) =>
      document.querySelector(`[data-order="${id}"] [data-cancel-error]`)!.textContent;
    // Simulate a cancellation from another tab while both browser requests are held.
    const external = await cancelOverRest(userId!);
    assert.equal(external.status, 200);
    const readsBeforeCancel = listOrderRequests;
    releaseCancellations.get(orderId)!();
    await waitFor(() => rowError(orderId)?.includes("вже скасовано") === true);
    await waitFor(() => status(orderId)?.includes("Скасовано") === true);
    assert.equal(document.querySelector(`[data-order="${orderId}"] [data-cancel-order]`), null);
    assert.equal(secondButton.disabled, true);
    assert.match(secondButton.textContent!, /Скасовуємо/);
    assert.equal(rowError(secondId), "");
    releaseCancellations.get(secondId)!();
    await waitFor(() => status(secondId)?.includes("Скасовано") === true);
    assert.equal(listOrderRequests, readsBeforeCancel);
    assert.match(status(orderId)!, /Скасовано/);
    assert.match(rowError(orderId)!, /вже скасовано/);
    assert.equal(rowError(secondId), "");
    assert.equal(document.querySelector(`[data-order="${secondId}"] [data-cancel-order]`), null);
    await waitFor(() => app.browserEvents.some(
      (event) => event.node === "orders.cancel.submit" && event.type === "action.finished",
    ));
    const cancelTrace = app.browserEvents.find(
      (event) => event.node === "orders.cancel.submit" && event.type === "action.started",
    )!;
    assert.ok(app.browserEvents.some((event) =>
      event.type === "binding.event" && event.node.endsWith(".each") && event.traceId === cancelTrace.traceId,
    ));
    assert.ok(app.traces.some((t) => t.operation === "orders.cancel" && t.id === cancelTrace.traceId));
    await waitFor(() => app.browserEvents.some((event) =>
      event.type === "resource.updated" && event.node === "orders.list.query" &&
      event.traceId === cancelTrace.traceId,
    ));
    const duplicate = await cancelOverRest(userId!);
    assert.equal(duplicate.status, 409);
    const conflict = await duplicate.json();
    assert.equal(conflict.error, "ORDER_ALREADY_CANCELLED");
    assert.equal(conflict.details.id, orderId);
    assert.equal(conflict.details.cancelled, true);

    input("[data-product]", "Cancel while switching");
    input("[data-quantity]", "1");
    submit("#orders form");
    const switchedOrder = () => [...document.querySelectorAll("[data-order]")].find(
      (row) => row.querySelector("strong")?.textContent === "Cancel while switching",
    );
    await waitFor(() => Boolean(switchedOrder()));
    const switchedId = switchedOrder()!.getAttribute("data-order")!;
    click(switchedOrder()!.querySelector<HTMLButtonElement>("[data-cancel-order]")!);
    await waitFor(() => releaseCancellations.has(switchedId));
    input("[data-search]", "");
    await waitFor(() => document.querySelectorAll("[data-user]").length === 2);
    const demoId = "00000000-0000-4000-8000-000000000001";
    document.querySelector(`[data-user="${demoId}"]`)!.dispatchEvent(new window.Event("click"));
    await waitFor(() => document.querySelector("[data-rows]")!.textContent === "" &&
      document.querySelector("[data-loading]")!.textContent === "");
    assert.equal((await cancelOverRest(userId!, switchedId)).status, 200);
    const readsWhileAway = listOrderRequests;
    const finishedCancellations = () => app.browserEvents.filter(
      (event) => event.node === "orders.cancel.submit" && event.type === "action.finished",
    ).length;
    const finishedBeforeRelease = finishedCancellations();
    releaseCancellations.get(switchedId)!();
    await waitFor(() => finishedCancellations() > finishedBeforeRelease);
    assert.equal(listOrderRequests, readsWhileAway);
    assert.equal(document.querySelector("[data-rows]")!.textContent, "");

    let releaseReturn!: () => void;
    returningOrders = {
      owner: userId!,
      wait: new Promise<void>((resolve) => { releaseReturn = resolve; }),
      release: releaseReturn,
    };
    document.querySelector(`[data-user="${userId}"]`)!.dispatchEvent(new window.Event("click"));
    await waitFor(() => switchedOrder()?.textContent?.includes("Скасовано") === true);
    assert.match(document.querySelector("[data-loading]")!.textContent!, /Завантажуємо/);
    returningOrders.release();
    returningOrders = undefined;
    await waitFor(() => document.querySelector("[data-loading]")!.textContent === "");
    const createdOverRest = await handler(app)(
      new Request("http://localhost/orders", {
        method: "POST",
        headers: {
          authorization: `Bearer ${userId}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ product: "REST order", quantity: 2 }),
      }),
    );
    assert.equal(createdOverRest.status, 201);
    const restOrder = await createdOverRest.json() as { id: string; product: string };
    assert.equal(restOrder.product, "REST order");
    const detailPath = `/orders/%${restOrder.id.charCodeAt(0).toString(16)}${restOrder.id.slice(1)}`;
    const readOrder = (path: string, actor: string) => fetch(`${origin}${path}`, {
      headers: { accept: "application/json", authorization: `Bearer ${actor}` },
    });
    const ownOrder = await readOrder(detailPath, userId!);
    assert.equal(ownOrder.status, 200);
    assert.equal((await ownOrder.json() as { id: string }).id, restOrder.id);
    const otherOrder = await readOrder(detailPath, demoId);
    assert.equal(otherOrder.status, 404);
    assert.match(await otherOrder.text(), /ORDER_NOT_FOUND/);
    const missing = await readOrder("/orders/00000000-0000-4000-8000-000000000099", userId!);
    assert.equal(missing.status, 404);

    const detail = await fetch(`${origin}${detailPath}`, { headers: { accept: "text/html" } });
    assert.equal(detail.status, 200);
    const { document: detailDocument, window: detailWindow } = parseHTML(await detail.text());
    const detailScript = detailDocument.querySelector("script")!.getAttribute("src")!;
    assert.equal(detailScript, ordersScript);
    script.runInNewContext({
      ...browserGlobals,
      document: detailDocument,
      window: browserWindow(detailWindow, new URL(`${origin}${detailPath}`)),
    });
    try {
      await waitFor(() => !!detailDocument.querySelector("#app nav"), "order detail route mounted");
      assert.equal(detailDocument.title, "Деталі замовлення — ARC Workspace");
      assert.ok(detailDocument.querySelector('#app nav a[href="/orders"].active'));
      assert.ok(detailDocument.head.querySelector("style")?.textContent?.includes(".workspace"));
      await waitFor(() => detailDocument.querySelector('section[aria-label="Замовлення"] [role=alert]')?.textContent?.includes("недоступне") === true);
      assert.equal(detailDocument.querySelector("[data-order-detail]"), null);
      await waitFor(() => Boolean(detailDocument.querySelector(`[data-user="${userId}"]`)));
      detailDocument.querySelector(`[data-user="${userId}"]`)!.dispatchEvent(new detailWindow.Event("click"));
      await waitFor(() => detailDocument.querySelector("[data-order-detail] h2")?.textContent === "REST order");
    } finally {
      detailWindow.dispatchEvent(new detailWindow.Event("pagehide"));
    }
    cleanupBrowser();
    cleanupBrowser = undefined;
    assert.equal(document.querySelector("#app")!.children.length, 0);
    assert.equal(document.head.querySelector("style"), null);
  } finally {
    cleanupBrowser?.();
    for (const release of releaseRequests) release();
    returningOrders?.release();
    for (const release of releaseCancellations.values()) release();
    await Promise.allSettled([...pending]);
    app.publish("application.stopping", "application");
    if (server) await closeServer(server);
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
