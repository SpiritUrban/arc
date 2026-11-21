import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { importApplication } from "../framework/src/fullstack/reactive-jsx.ts";
import { buildWeb } from "../framework/src/fullstack/build.ts";
import { internalTransport } from "../framework/src/fullstack/server.ts";
import { serve, closeServer, handler } from "../framework/src/http.ts";

test("Workspace browser creates users/orders, handles business errors and isolates selected user data", async () => {
  const { createApp } = await importApplication(
    new URL("../examples/workspace/app.ts", import.meta.url),
  ) as typeof import("../examples/workspace/app.ts");
  const app = createApp();
  const dir = await mkdtemp(join(tmpdir(), "arc-workspace-"));
  let server: Awaited<ReturnType<typeof serve>> | undefined;
  let cleanupBrowser: (() => void) | undefined;
  const pending = new Set<Promise<any>>();
  try {
    await app.compile();
    const { edges, nodes } = app.graph();
    assert.equal(
      nodes.filter(({ id }) => id.startsWith("users.page.dom.") && id.endsWith(".render")).length,
      3,
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
      e.from === "users.create.submit" && e.to === "users.list.query" && e.kind === "INVALIDATES",
    ));
    assert.ok(edges.some((e) =>
      e.from === "users.list.query" && e.to === "users.list" && e.kind === "REMOTE_CALLS",
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
    assert.ok(built.manifest.inputs.includes("examples/workspace/browser.ts"));
    assert.ok(!built.manifest.inputs.includes("examples/workspace/users/server.ts"));
    assert.ok(!built.manifest.inputs.includes("examples/workspace/orders/server.ts"));
    assert.ok(!built.manifest.inputs.includes("examples/workspace/auth.ts"));
    server = await serve(internalTransport(app), { port: 0 });
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const { window, document } = parseHTML(
      '<html><head></head><body><div id="app"></div></body></html>',
    );
    const fetcher: typeof fetch = (input, init) => {
      const promise = fetch(new URL(String(input), origin), init);
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
    const context = vm.createContext({
      window,
      document,
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
    });
    new vm.Script(
      await readFile(join(built.outDir, "app.js"), "utf8"),
    ).runInContext(context);
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
    const userForm = document.querySelector("#users form")!;
    const userFields = Array.from(userForm.querySelectorAll<HTMLInputElement>("input[name]"));
    Object.defineProperty(userForm, "elements", { value: userFields });
    for (const field of userFields) {
      Object.defineProperties(field, {
        form: { value: userForm },
        defaultValue: { value: "" },
      });
    }
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
    input("[data-product]", "Rejected product");
    input("[data-quantity]", "0");
    submit("#orders form");
    await waitFor(() =>
      document.querySelector("#orders [role=alert]")!.textContent!.includes("Перевірте введені дані"),
    );
    assert.equal(quantity.value, "0");
    assert.equal(
      document.querySelector<HTMLInputElement>("[data-product]")!.value,
      "Rejected product",
    );
    assert.equal(document.querySelectorAll("[data-rows] tr").length, 1);
    input("[data-name]", "Duplicate User");
    input("[data-email]", "new@example.com");
    submit("#users form");
    await waitFor(() =>
      document
        .querySelector("#users [role=alert]")!
        .textContent!.includes("вже існує"),
    );
    assert.equal(
      document.querySelector<HTMLInputElement>("[data-name]")!.value,
      "Duplicate User",
    );
    assert.match(
      document.querySelector("[data-user].selected")!.textContent!,
      /New User/,
    );
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
    document
      .querySelector("[data-user]")!
      .dispatchEvent(new window.Event("click", { bubbles: true }));
    await waitFor(() =>
      document
        .querySelector("[data-rows]")!
        .textContent!.includes("ARC Notebook"),
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
  } finally {
    cleanupBrowser?.();
    await Promise.allSettled([...pending]);
    app.publish("application.stopping", "application");
    if (server) await closeServer(server);
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
