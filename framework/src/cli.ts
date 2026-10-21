import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Application } from "./core.js";
import { handler, serve, closeServer } from "./http.js";
import { stand } from "./stand.js";
const [command = "stand", argument] = process.argv.slice(2);
if (!["stand", "dev", "start", "graph", "inspect", "run"].includes(command)) {
  console.error("Usage: arc stand|start|graph|inspect <id>|run <id> <json>");
  process.exit(1);
}
const { default: app } = await import(
  pathToFileURL(resolve(process.env.ARC_APP ?? "src/app.ts")).href
);
if (!(app instanceof Application))
  throw new Error("Application entry must default-export an ARC application");
await app.compile();
if (["graph", "inspect", "run"].includes(command)) {
  try {
    if (command === "run") {
      await app.start();
      console.log(
        JSON.stringify(
          await app.execute(argument, JSON.parse(process.argv[4] ?? "{}")),
          null,
          2,
        ),
      );
    } else {
      const graph = app.graph();
      const output =
        command === "graph"
          ? graph
          : graph.nodes.find((n) => n.id === argument);
      if (!output) throw new Error(`Unknown node: ${argument}`);
      console.log(JSON.stringify(output, null, 2));
    }
  } finally {
    await app.close();
  }
} else {
  const servers: Awaited<ReturnType<typeof serve>>[] = [];
  try {
    await app.start();
    const port = Number(process.env.PORT ?? 3000);
    servers.push(await serve(handler(app), { port }));
    console.log(`ARC application  http://localhost:${port}`);
    if (command !== "start") {
      const standPort = Number(process.env.STAND_PORT ?? 3100);
      servers.push(
        await serve(
          stand(app, {
            networkBaseUrl: `http://127.0.0.1:${port}`,
            testFile: resolve(".arc/stand-tests.json"),
          }),
          { port: standPort },
        ),
      );
      console.log(`ARC Stand        http://localhost:${standPort}`);
    }
    console.log(
      `${app.operations.length} operations · ${app.resources.length} resources · ${app.routes.length} routes · architecture valid`,
    );
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      try {
        app.publish("application.stopping", "application");
        await Promise.all(servers.map(closeServer));
        await app.close();
      } catch (e) {
        console.error(e);
        process.exitCode = 1;
      }
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch (e) {
    await Promise.all(servers.map(closeServer));
    await app.close();
    throw e;
  }
}
