import type { GraphDefinition } from "../neutral/graph.js";
export interface Readable<T> extends GraphDefinition {
  _trace?: import("../neutral/protocol.js").TraceToken;
  get(): T;
  subscribe(fn: () => void): () => void;
  dispose(): void;
  _children: Set<Computed<any>>;
  _listeners: Set<() => void>;
}
export interface Writable<T> extends Readable<T> {
  set(value: T): void;
  update(fn: (value: T) => T): void;
}
const dirty = new Set<Computed<any>>(),
  notifications = new Set<() => void>();
let scheduled = false,
  depth = 0,
  flushing = false;
const enqueue = () => {
  if (!scheduled && !depth) {
    scheduled = true;
    queueMicrotask(flush);
  }
};
function notify(node: Readable<any>) {
  for (const fn of node._listeners) notifications.add(fn);
  for (const child of node._children) {
    if (!child.dirty) {
      child.dirty = true;
      dirty.add(child);
      notifyChildren(child);
    }
  }
  enqueue();
}
function notifyChildren(node: Readable<any>) {
  for (const child of node._children) {
    if (!child.dirty) {
      child.dirty = true;
      dirty.add(child);
      notifyChildren(child);
    }
  }
}
export function flush() {
  if (flushing || depth) return;
  scheduled = false;
  flushing = true;
  try {
    let iterations = 0;
    while (dirty.size || notifications.size) {
      if (++iterations > 1000)
        throw new Error("ARC-WEB-204 reactive feedback loop");
      for (const d of [...dirty]) d.recompute();
      const tasks = [...notifications];
      notifications.clear();
      for (const fn of tasks) fn();
    }
  } finally {
    flushing = false;
  }
}
export async function tick() {
  await Promise.resolve();
  flush();
}
export function batch<T>(fn: () => T): T {
  depth++;
  try {
    return fn();
  } finally {
    depth--;
    enqueue();
  }
}
export function state<T>(def: {
  id: string;
  initial: T;
  scope?: "application" | "view";
}): Writable<T> {
  let value = def.initial,
    disposed = false;
  const node: Writable<T> = {
    id: def.id,
    kind: "state",
    runtime: "browser",
    metadata: { scope: def.scope ?? "application" },
    _children: new Set(),
    _listeners: new Set(),
    get: () => value,
    set(next) {
      if (disposed) throw new Error(`Disposed state: ${def.id}`);
      if (!Object.is(next, value)) {
        value = next;
        notify(node);
      }
    },
    update(fn) {
      node.set(fn(value));
    },
    subscribe(fn) {
      if (disposed) throw new Error("Disposed state");
      node._listeners.add(fn);
      return () => {
        node._listeners.delete(fn);
        notifications.delete(fn);
      };
    },
    dispose() {
      disposed = true;
      for (const fn of node._listeners) notifications.delete(fn);
      node._listeners.clear();
      node._children.clear();
    },
  };
  return node;
}
export interface Computed<T> extends Readable<T> {
  dirty: boolean;
  recompute(): void;
}
export function derive<const D extends readonly Readable<any>[], T>(def: {
  id: string;
  from: D;
  compute: (
    ...values: { [K in keyof D]: D[K] extends Readable<infer V> ? V : never }
  ) => T;
}): Computed<T> {
  let value: T,
    ready = false,
    computing = false,
    disposed = false;
  const node: Computed<T> = {
    id: def.id,
    kind: "derived",
    runtime: "browser",
    dependencies: def.from,
    dirty: true,
    _children: new Set(),
    _listeners: new Set(),
    recompute() {
      if (!node.dirty || disposed) return;
      if (computing) throw new Error(`ARC-WEB-204 derived cycle: ${node.id}`);
      computing = true;
      try {
        const next = def.compute(...(def.from.map((d) => d.get()) as any));
        const changed = !ready || !Object.is(next, value);
        node._trace = def.from.find((d) => d._trace)?._trace;
        value = next;
        ready = true;
        node.dirty = false;
        dirty.delete(node);
        if (changed) for (const fn of node._listeners) notifications.add(fn);
      } finally {
        computing = false;
      }
    },
    get() {
      if (node.dirty) node.recompute();
      return value!;
    },
    subscribe(fn) {
      if (disposed) throw new Error("Disposed derived");
      node._listeners.add(fn);
      return () => {
        node._listeners.delete(fn);
        notifications.delete(fn);
      };
    },
    dispose() {
      disposed = true;
      dirty.delete(node);
      for (const dep of def.from) dep._children.delete(node);
      for (const fn of node._listeners) notifications.delete(fn);
      node._listeners.clear();
      node._children.clear();
    },
  };
  for (const dep of def.from) {
    if (!dep?._children)
      throw new Error(`ARC-WEB-202 invalid reactive dependency: ${def.id}`);
    dep._children.add(node);
  }
  node.recompute();
  return node;
}
export class Scope {
  private cleanups: (() => void)[] = [];
  disposed = false;
  own<T extends { dispose(): void }>(item: T): T {
    this.add(() => item.dispose());
    return item;
  }
  add(cleanup: () => void) {
    if (this.disposed) cleanup();
    else this.cleanups.push(cleanup);
    return cleanup;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    for (const fn of this.cleanups.splice(0).reverse())
      try {
        fn();
      } catch (e) {
        errors.push(e);
      }
    if (errors.length)
      throw new AggregateError(errors, "Web scope cleanup failed");
  }
}
