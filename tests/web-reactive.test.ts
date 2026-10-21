import { test } from "node:test";
import assert from "node:assert/strict";
import {
  state,
  derive,
  batch,
  tick,
  Scope,
} from "../framework/src/web/index.ts";
test("state and explicit derived DAG batch one propagation", async () => {
  const a = state({ id: "a", initial: 1 }),
    b = state({ id: "b", initial: 2 });
  let recomputes = 0,
    updates = 0;
  const sum = derive({
    id: "sum",
    from: [a, b],
    compute: (a, b) => {
      recomputes++;
      return a + b;
    },
  });
  const doubled = derive({ id: "double", from: [sum], compute: (n) => n * 2 });
  doubled.subscribe(() => updates++);
  batch(() => {
    a.set(5);
    b.update((n) => n + 2);
    for (let i = 0; i < 100; i++) a.set(i);
  });
  await tick();
  assert.equal(sum.get(), 103);
  assert.equal(doubled.get(), 206);
  assert.equal(recomputes, 2);
  assert.equal(updates, 1);
  a.dispose();
  b.dispose();
  sum.dispose();
  doubled.dispose();
});
test("scope disposal removes subscriptions and derived links", async () => {
  const source = state({ id: "source", initial: 0 });
  const scope = new Scope();
  const d = scope.own(
    derive({ id: "d", from: [source], compute: (n) => n + 1 }),
  );
  let notified = 0;
  scope.add(d.subscribe(() => notified++));
  scope.dispose();
  source.set(1);
  await tick();
  assert.equal(notified, 0);
  assert.equal(source._children.size, 0);
  assert.equal(d._listeners.size, 0);
  source.dispose();
});
