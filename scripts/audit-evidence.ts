import { writeFile } from "node:fs/promises";
import {
  application,
  resource,
  operation,
  queue,
  schedule,
  http,
  s,
  ok,
} from "../framework/src/index.ts";
const session = resource({
  id: "session",
  scope: "request",
  estimateMs: 1,
  open: () => ({ userId: "demo" }),
});
const read = operation({
  id: "read",
  input: s.object({}),
  output: s.string(),
  needs: { session },
  estimateMs: 2,
  run: ({ session }) => ok(session.userId),
});
const parent = operation({
  id: "parent",
  input: s.object({}),
  output: s.string(),
  needs: { session },
  calls: { read },
  estimateMs: 1,
  budgetMs: 20,
  async run({ call }) {
    return call("read", {});
  },
});
const app = application({
  operations: [parent],
  routes: [http.get("/demo", parent)],
  queues: [queue({ id: "jobs", operation: read, concurrency: 2 })],
  schedules: [
    schedule({
      id: "refresh",
      operation: read,
      everyMs: 60000,
      input: () => ({}),
    }),
  ],
});
await app.compile();
await writeFile(
  "docs/audit/architecture-ir.json",
  JSON.stringify(app.graph(), null, 2) + "\n",
);
await app.start();
try {
  await app.execute("parent", {});
  await writeFile(
    "docs/audit/nested-trace.json",
    JSON.stringify(app.traces[0], null, 2) + "\n",
  );
} finally {
  await app.close();
}
