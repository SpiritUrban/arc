import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { importApplication } from "../framework/src/fullstack/reactive-jsx.ts";
import { buildWeb, staticWeb } from "../framework/src/fullstack/build.ts";
import { internalTransport } from "../framework/src/fullstack/server.ts";
import { serve, closeServer, handler } from "../framework/src/http.ts";

test("Workspace browser creates users/orders, handles business errors and isolates selected user data", async () => {
  const entry = new URL("../examples/workspace/app.ts", import.meta.url);
  const { createApp } = await importApplication(entry) as typeof import("../examples/workspace/app.ts");
  const app = createApp();
  const dir = await mkdtemp(join(tmpdir(), "arc-workspace-"));
  let server: Awaited<ReturnType<typeof serve>> | undefined;
  let cleanupBrowser: (() => void) | undefined;
  const pending = new Set<Promise<any>>();
  const releaseCancellations = new Map<string, () => void>();
  let returningOrders: { owner: string; wait: Promise<void>; release(): void } | undefined;
  try {
    await app.compile({ entry });
    const { edges, nodes } = app.graph();
    assert.equal(
      nodes.filter(({ id }) => id.startsWith("users.page.dom.") && id.endsWith(".render")).length,
      4,
    );
    assert.ok(nodes.some(({ id }) => id.startsWith("users.page.dom.") && id.endsWith(".each")));
    assert.equal(
      edges.filter((edge) =>
        edge.to.startsWith("orders.page.dom.") &&
        edge.to.endsWith(".text") &&
        edge.from === "orders.visible" &&
        edge.kind === "BINDS",
      ).length,
      2,
    );
    assert.ok(edges.some((e) =>
      e.from === "orders.create.submit.remote" && e.to === "orders.create" && e.kind === "REMOTE_CALLS",
    ));
    assert.ok(edges.some((e) =>
      e.from === "orders.create.submit" && e.to === "orders.list.query" && e.kind === "INVALIDATES",
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
    assert.ok(edges.some((e) =>
      e.from === "users.list.query" &&
      e.to.startsWith("users.page.dom.") &&
      e.to.endsWith(".render") &&
      e.kind === "BINDS",
    ));
    for (const from of ["orders.list.query", "orders.create.submit"]) {
      assert.ok(edges.some((edge) =>
        edge.from === from &&
        edge.to === "workspace.selected-user" &&
        edge.kind === "DEPENDS_ON",
      ));
    }
    await app.start();
    const built = await buildWeb(app, { outDir: dir });
    assert.ok(nodes.some(({ id }) => id === "page:orders-screen"));
    assert.ok(built.manifest.inputs.includes("examples/workspace/page.tsx"));
    assert.ok(built.manifest.inputs.some((input) => input.endsWith("arc-page-entry.js")));
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
    assert.notEqual(ordersScript, "/app.js");
    const asset = await fetch(`${origin}${ordersScript}`);
    assert.equal(asset.status, 200);
    const ordersCode = await asset.text();
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
      let ready = Promise.resolve();
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
      AbortController,
      performance,
      queueMicrotask,
      setTimeout,
      clearTimeout,
      console,
    };
    new vm.Script(ordersCode).runInContext(vm.createContext({
      ...browserGlobals,
      window: ordersWindow,
      document: ordersDocument,
    }));
    assert.equal(ordersDocument.title, "Замовлення — ARC Workspace");
    assert.equal(ordersDocument.querySelector("#app h1")!.textContent, "Замовлення");
    assert.equal(ordersDocument.querySelector("#app a[href='/']")!.textContent!.trim(), "ARC Workspace");
    ordersWindow.dispatchEvent(new ordersWindow.Event("pagehide"));
    const context = vm.createContext({ ...browserGlobals, window, document });
    new vm.Script(
      await readFile(join(built.outDir, "app.js"), "utf8"),
    ).runInContext(context);
    assert.match(document.title, /ARC Workspace/);
    assert.ok(document.head.querySelector("style")?.textContent?.includes(".workspace"));
    cleanupBrowser = () => window.dispatchEvent(new window.Event("pagehide"));
    const waitFor = async (predicate: () => boolean) => {
      for (let i = 0; i < 200; i++) {
        if (predicate()) return;
        await new Promise((r) => setTimeout(r, 5));
      }
      assert.ok(predicate(), "Workspace interaction did not settle");
    };
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
    submit("#users form");
    assert.equal(addButton.disabled, true);
    await waitFor(() => document.querySelectorAll("[data-user]").length === 2);
    assert.equal(addButton.disabled, false);
    assert.match(document.querySelector("#users [data-status]")!.textContent!, /^2 /);
    assert.deepEqual(userFields.map((field) => field.value), ["", ""]);
    await waitFor(() =>
      document
        .querySelector("[data-user].selected")!
        .textContent!.includes("<New User>"),
    );
    assert.equal(
      document.querySelector("[data-user].selected")!.querySelector("new"),
      null,
      "user markup must be escaped",
    );
    await waitFor(
      () => document.querySelector("[data-loading]")!.textContent === "",
    );
    input("[data-product]", "  ARC Notebook  ");
    input("[data-quantity]", "3");
    await waitFor(() => document.querySelector("[data-preview]")!.textContent!.includes("75"));
    const orderButton = document.querySelector<HTMLButtonElement>("#orders button[type=submit]")!;
    submit("#orders form");
    assert.equal(orderButton.disabled, true);
    await waitFor(() =>
      document
        .querySelector("[data-rows]")!
        .textContent!.includes("ARC Notebook"),
    );
    assert.equal(orderButton.disabled, false);
    assert.match(document.querySelector("[data-amount]")!.textContent!, /75/);
    assert.equal(document.querySelector("[data-count]")!.textContent, "01");
    assert.equal(
      document.querySelector("[data-rows] strong")!.textContent,
      "ARC Notebook",
    );
    const userId = document.querySelector("[data-user].selected")!.getAttribute("data-user");
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
      document.querySelector("#orders [data-error]")!.textContent!.includes("Перевірте введені дані"),
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
      document.querySelector("[data-user].selected")!.textContent!,
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
    const newUserRow = document.querySelector("[data-user].selected")!;
    const demoUserRow = document.querySelector(
      '[data-user="00000000-0000-4000-8000-000000000001"]',
    )!;
    demoUserRow.dispatchEvent(new window.Event("click", { bubbles: true }));
    await waitFor(() =>
      document
        .querySelector("[data-user].selected")!
        .textContent!.includes("Demo User"),
    );
    assert.equal(document.querySelector("[data-user].selected"), demoUserRow);
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
    const cancelOverRest = (actor: string) => handler(app)(
      new Request("http://localhost/orders/cancel", {
        method: "POST",
        headers: {
          authorization: `Bearer ${actor}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: orderId }),
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
    releaseCancellations.get(orderId)!();
    await waitFor(() => rowError(orderId)?.includes("вже скасовано") === true);
    assert.equal(firstButton.disabled, false);
    assert.equal(secondButton.disabled, true);
    assert.match(secondButton.textContent!, /Скасовуємо/);
    assert.equal(rowError(secondId), "");
    click(firstButton);
    await waitFor(() => firstButton.disabled && cancelOrderRequests === 3);
    assert.equal(rowError(orderId), "");
    assert.equal(secondButton.disabled, true);
    releaseCancellations.get(orderId)!();
    await waitFor(() => rowError(orderId)?.includes("вже скасовано") === true);
    const readsBeforeCancel = listOrderRequests;
    releaseCancellations.get(secondId)!();
    await waitFor(() => status(secondId)?.includes("Скасовано") === true);
    assert.equal(listOrderRequests, readsBeforeCancel);
    assert.match(status(orderId)!, /Створено/);
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
    const duplicate = await cancelOverRest(userId!);
    assert.equal(duplicate.status, 409);
    assert.match(await duplicate.text(), /ORDER_ALREADY_CANCELLED/);

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
    assert.match(await createdOverRest.text(), /REST order/);
    cleanupBrowser();
    cleanupBrowser = undefined;
    assert.equal(document.querySelector("#app")!.children.length, 0);
    assert.equal(document.head.querySelector("style"), null);
  } finally {
    cleanupBrowser?.();
    returningOrders?.release();
    for (const release of releaseCancellations.values()) release();
    await Promise.allSettled([...pending]);
    app.publish("application.stopping", "application");
    if (server) await closeServer(server);
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
