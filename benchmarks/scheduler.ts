import {
  application,
  operation,
  resource,
  s,
  ok,
} from "../framework/src/index.ts";
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rounds = 5;
async function legacy() {
  const start = performance.now();
  await Promise.all([delay(80), delay(5)]);
  await delay(80);
  return performance.now() - start;
}
const slow = resource({
  id: "slow",
  scope: "request",
  async open() {
    await delay(80);
    return 1;
  },
});
const fast = resource({
  id: "fast",
  scope: "request",
  async open() {
    await delay(5);
    return 1;
  },
});
const child = resource({
  id: "child",
  scope: "request",
  needs: { fast },
  async open() {
    await delay(80);
    return 1;
  },
});
const op = operation({
  id: "dag",
  input: s.object({}),
  output: s.int(),
  needs: { slow, child },
  run: () => ok(1),
});
const app = application({ operations: [op] });
await app.compile();
await app.start();
const before: number[] = [],
  after: number[] = [];
try {
  for (let i = 0; i < rounds; i++) {
    before.push(await legacy());
    const start = performance.now();
    await app.execute("dag", {});
    after.push(performance.now() - start);
  }
} finally {
  await app.close();
}
const avg = (values: number[]) =>
  values.reduce((a, b) => a + b, 0) / values.length;
console.log(
  JSON.stringify(
    {
      kind: "synthetic timer DAG, not HTTP/deployment throughput",
      nodeDelaysMs: { slow: 80, fast: 5, childAfterFast: 80 },
      rounds,
      legacyLevelBarrierMs: before,
      dependencyReadyMs: after,
      beforeMeanMs: avg(before),
      afterMeanMs: avg(after),
      latencyReductionPercent: (1 - avg(after) / avg(before)) * 100,
    },
    null,
    2,
  ),
);
