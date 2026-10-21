import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { createApp } from "../src/app.ts";
import { buildWeb } from "../framework/src/fullstack/build.ts";
import { internalTransport } from "../framework/src/fullstack/server.ts";
import { serve, closeServer } from "../framework/src/http.ts";

test("root Workspace browser creates users/orders, handles business errors and isolates selected user data", async () => {
  const app = createApp();
  const dir = await mkdtemp(join(tmpdir(), "arc-workspace-"));
  let server: Awaited<ReturnType<typeof serve>> | undefined;
  let cleanupBrowser: (() => void) | undefined;
  const pending = new Set<Promise<any>>();
  try {
    await app.compile();
    await app.start();
    const built = await buildWeb(app, { outDir: dir });
    assert.ok(built.manifest.inputs.includes("src/browser.ts"));
    assert.ok(!built.manifest.inputs.includes("src/users/index.ts"));
    assert.ok(!built.manifest.inputs.includes("src/orders/index.ts"));
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
    const context = vm.createContext({
      window,
      document,
      crypto: globalThis.crypto,
      fetch: fetcher,
      Request,
      Response,
      Headers,
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
    input("[data-name]", "<New User>");
    input("[data-email]", "new@example.com");
    submit("#users form");
    await waitFor(() => document.querySelectorAll("[data-user]").length === 2);
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
    input("[data-product]", "ARC Notebook");
    input("[data-quantity]", "3");
    submit("#orders form");
    await waitFor(() =>
      document
        .querySelector("[data-rows]")!
        .textContent!.includes("ARC Notebook"),
    );
    assert.match(document.querySelector("[data-amount]")!.textContent!, /75/);
    assert.equal(
      (document.querySelector("[data-product]")! as unknown as HTMLInputElement)
        .value,
      "",
    );
    input("[data-name]", "Duplicate User");
    input("[data-email]", "new@example.com");
    submit("#users form");
    await waitFor(() =>
      document
        .querySelector("#users [role=alert]")!
        .textContent!.includes("вже існує"),
    );
    assert.equal(document.querySelectorAll("[data-user]").length, 2);
    document
      .querySelector('[data-user="00000000-0000-4000-8000-000000000001"]')!
      .dispatchEvent(new window.Event("click", { bubbles: true }));
    await waitFor(() =>
      document
        .querySelector("[data-user].selected")!
        .textContent!.includes("Demo User"),
    );
    await waitFor(
      () =>
        document.querySelector("[data-rows]")!.textContent === "" &&
        document.querySelector("[data-loading]")!.textContent === "",
    );
    assert.match(document.querySelector("[data-amount]")!.textContent!, /0/);
    input("[data-search]", "new@example.com");
    await waitFor(() => document.querySelectorAll("[data-user]").length === 1);
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
        (e) => e.node === "orders.add" && e.type === "action.finished",
      ),
    );
    const trace = app.browserEvents.find(
      (e) => e.node === "orders.add" && e.type === "action.started",
    )!;
    assert.ok(
      app.traces.some(
        (t) => t.operation === "orders.create" && t.id === trace.traceId,
      ),
    );
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
