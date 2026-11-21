import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { PageAssets } from "./fullstack/build.js";
import { importApplication } from "./fullstack/reactive-jsx.js";
import { Application } from "./core.js";
import { handler, serve, closeServer } from "./http.js";
import { stand } from "./stand.js";
const [command = "stand", argument] = process.argv.slice(2);
if (
  !["stand", "dev", "start", "build", "graph", "inspect", "run"].includes(
    command,
  )
)
  throw new Error(
    "Usage: arc dev|build|graph|inspect <id>|run <id> <json>|start|stand",
  );
const entry = pathToFileURL(resolve(process.env.ARC_APP ?? "src/app.ts"));
const { default: logical } = await importApplication(entry);
if (!(logical instanceof Application) && logical?.kind !== "arc-graph")
  throw new Error("Default-export an ARC application graph");
await (logical instanceof Application ? logical.compile({ entry }) : logical.compile());
const isServer = logical instanceof Application;
// Browser-only development tooling has a server-side telemetry host, not another architecture graph.
const host: Application = isServer ? logical : new Application({});
if (!isServer) {
  await host.compile();
  host.graph = () => logical.graph();
}
if (["graph", "inspect", "build", "run"].includes(command)) {
  try {
    if (command === "build") {
      if (logical.webConfig()?.entry) {
        const { buildWeb } = await import("./fullstack/build.js");
        const result = await buildWeb(logical);
        console.log(JSON.stringify(result.manifest, null, 2));
      } else
        console.log(
          JSON.stringify(
            {
              version: 3,
              partitions: logical.graph().partitions,
              note: "Server JS compilation: npm run build",
            },
            null,
            2,
          ),
        );
    } else if (command === "run") {
      if (!isServer)
        throw new Error("No server operations in browser-only graph");
      await host.start();
      console.log(
        JSON.stringify(
          await host.execute(argument, JSON.parse(process.argv[4] ?? "{}")),
          null,
          2,
        ),
      );
    } else {
      const graph = logical.graph();
      const output =
        command === "graph"
          ? graph
          : graph.nodes.find((n: any) => n.id === argument);
      if (!output) throw new Error("Unknown graph node");
      console.log(JSON.stringify(output, null, 2));
    }
  } finally {
    await host.close();
  }
} else {
  const servers: Awaited<ReturnType<typeof serve>>[] = [];
  let webDir: string | undefined;
  let webPages: PageAssets[] | undefined;
  const removeWebBuild = () =>
    webDir ? rm(webDir, { recursive: true, force: true }) : Promise.resolve();
  try {
    if (logical.webConfig()?.entry) {
      const { buildWeb } = await import("./fullstack/build.js");
      webDir = await mkdtemp(join(tmpdir(), "arc-web-"));
      webPages = (await buildWeb(logical, { outDir: webDir })).pages;
    }
    await host.start();
    const port = Number(process.env.PORT ?? 3000),
      serverHandler = isServer ? handler(host) : undefined;
    const { internalTransport } = await import("./fullstack/server.js");
    const bridge = internalTransport(host);
    const web = webDir
      ? (await import("./fullstack/build.js")).staticWeb
      : undefined;
    servers.push(
      await serve(
        async (request) => {
          const path = new URL(request.url).pathname;
          if (path.startsWith("/_arc/")) return bridge(request);
          const asset = webDir && web ? await web(webDir, request, webPages) : undefined;
          if (asset) return asset;
          const response = serverHandler
            ? await serverHandler(request)
            : new Response("Not found", { status: 404 });
          if (webPages?.some((page) => page.path === path && page.api) &&
              (request.method === "GET" || request.method === "HEAD"))
            response.headers.append("vary", "Accept");
          return response;
        },
        { port },
      ),
    );
    console.log(
      `ARC ${isServer ? "Server" : "Web dev host"} http://localhost:${port}`,
    );
    if (webDir)
      console.log(
        `ARC Web             http://localhost:${port} (same-origin internal transport)`,
      );
    if (command !== "start") {
      const standPort = Number(process.env.STAND_PORT ?? 3100);
      servers.push(
        await serve(
          stand(host, {
            networkBaseUrl: `http://127.0.0.1:${port}`,
            testFile: resolve(".arc/stand-tests.json"),
          }),
          { port: standPort },
        ),
      );
      console.log(`ARC Stand           http://localhost:${standPort}`);
    }
    console.log(
      `IR v3: ${logical.graph().nodes.length} nodes · ${logical.graph().boundaries?.length ?? 0} remote boundaries`,
    );
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      try {
        host.publish("application.stopping", "application");
        await Promise.all(servers.map(closeServer));
        await host.close();
      } catch (error) {
        console.error(error);
        process.exitCode = 1;
      } finally {
        await removeWebBuild().catch((error) => {
          console.error(error);
          process.exitCode = 1;
        });
      }
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch (error) {
    host.publish("application.stopping", "application");
    try {
      await Promise.all(servers.map(closeServer));
      await host.close();
    } finally {
      await removeWebBuild();
    }
    throw error;
  }
}
