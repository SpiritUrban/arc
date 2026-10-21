import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWeb } from "../framework/src/fullstack/build.ts";
import counter from "../examples/web-counter/app.ts";
import { createApp } from "../examples/fullstack-tasks/app.ts";
import { application } from "../framework/src/index.ts";
import { remoteClient } from "../framework/src/fullstack/client.ts";
import { read } from "../examples/leak-check/server.ts";
test("pure Web and Fullstack build manifests have no Node/server implementation in browser", async () => {
  const tasks = createApp();
  const dir = await mkdtemp(join(tmpdir(), "arc-browser-"));
  try {
    for (const [name, app] of [
      ["counter", counter],
      ["tasks", tasks],
    ] as const) {
      await app.compile();
      const result = await buildWeb(app, { outDir: join(dir, name) });
      const code = await readFile(join(result.outDir, "app.js"), "utf8");
      assert.ok(!code.includes("node:http"));
      assert.ok(!code.includes("AsyncLocalStorage"));
      assert.ok(!code.includes("tasksRepository"));
      assert.ok(
        result.manifest.inputs.every(
          (p) => !p.includes("fullstack-tasks/server.ts"),
        ),
      );
      assert.equal(result.manifest.version, 3);
    }
    assert.equal(counter.graph().partitions?.server.length, 0);
  } finally {
    await tasks.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("direct remote(serverOperation) compiles server module to descriptors; unmarked server import fails browser build", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arc-secret-"));
  const remote = remoteClient(read, { id: "leak.remote" });
  const config = {
    nodes: [remote],
    entry: "examples/leak-check/browser.ts",
    serverModules: ["examples/leak-check/server.ts"],
  };
  const app = application({ operations: [read], web: config });
  try {
    await app.compile();
    const built = await buildWeb(app, { outDir: dir });
    const code = await readFile(join(dir, "app.js"), "utf8");
    assert.ok(!code.includes("ARC_PRIVATE_DATABASE_SECRET"));
    assert.ok(!code.includes("node:"));
    const unsafe = application({
      operations: [read],
      web: { ...config, serverModules: [] },
    });
    await unsafe.compile();
    await assert.rejects(
      buildWeb(unsafe, { outDir: join(dir, "bad") }),
      /Node builtin|server implementation|Build failed/,
    );
    await unsafe.close();
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("Web/Core/Fullstack client entrypoints bundle browser-only; server entry excludes DOM runtime", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arc-entry-"));
  try {
    for (const entry of ["web", "core-entry", "fullstack/client"]) {
      const result = await build({
        entryPoints: [
          `framework/src/${entry === "web" ? "web/index" : entry}.ts`,
        ],
        bundle: true,
        platform: "browser",
        write: false,
        metafile: true,
      });
      assert.ok(!result.outputFiles[0].text.includes("node:"));
    }
    const result = await build({
      entryPoints: ["framework/src/server.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
      metafile: true,
    });
    assert.ok(
      Object.keys(result.metafile!.inputs).every(
        (p) => !p.includes("/web/") && !p.includes("fullstack/build"),
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("external web resource works with normal fetch without ARC backend", async () => {
  const { externalTodo } = await import("../examples/web-external/example.ts");
  let requested = "";
  const resource = externalTodo(async (input) => {
    requested = String(input);
    return Response.json({ title: "external" });
  });
  await resource.refresh();
  assert.match(requested, /jsonplaceholder/);
  assert.equal(resource.data.get()?.title, "external");
  resource.dispose();
});

test("canonical compiled browser bundle clicks Add across actual HTTP and joins interaction telemetry", async () => {
  const vm = await import("node:vm"),
    { parseHTML } = await import("linkedom");
  const { serve, closeServer } = await import("../framework/src/http.ts");
  const { internalTransport } =
    await import("../framework/src/fullstack/server.ts");
  const dir = await mkdtemp(join(tmpdir(), "arc-browser-network-"));
  let server: Awaited<ReturnType<typeof serve>> | undefined;
  // Import a fresh logical app before server activation; browser bundle executes its own state instances.
  const app = createApp();
  try {
    await app.compile();
    await app.start();
    const built = await buildWeb(app, { outDir: dir });
    server = await serve(internalTransport(app), { port: 0 });
    const port = (server.address() as { port: number }).port,
      origin = `http://127.0.0.1:${port}`;
    const { window, document } = parseHTML('<div id="app"></div>');
    const pending = new Set<Promise<any>>();
    const fetcher: typeof fetch = (input, init) => {
      const task = fetch(new URL(String(input), origin), init);
      pending.add(task);
      void task.finally(() => pending.delete(task)).catch(() => {});
      return task;
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
    const waitFor = async (predicate: () => boolean) => {
      for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await new Promise((r) => setTimeout(r, 5));
      }
      assert.ok(predicate(), "browser interaction did not settle");
    };
    await waitFor(() => document.querySelector("input") !== null);
    await waitFor(
      () => !document.querySelector("main")!.textContent.includes("Loading"),
    );
    const input = document.querySelector("input")!;
    input.value = "Network task";
    input.dispatchEvent(new window.Event("input"));
    document.querySelector("button")!.dispatchEvent(new window.Event("click"));
    await waitFor(() =>
      document.querySelector("pre")!.textContent.includes("Network task"),
    );
    await waitFor(() =>
      app.browserEvents.some((e) => e.type === "action.finished"),
    );
    const event = app.browserEvents.find((e) => e.type === "action.started")!;
    assert.ok(event.traceId);
    assert.ok(app.traces.filter((t) => t.id === event.traceId).length >= 2);
    assert.ok(
      app.browserEvents.some(
        (e) => e.traceId === event.traceId && e.type === "binding.updated",
      ),
    );
    window.dispatchEvent(new window.Event("pagehide"));
    await Promise.allSettled([...pending]);
  } finally {
    app.publish("application.stopping", "application");
    if (server) await closeServer(server);
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
