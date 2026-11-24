import type { TraceToken } from "../neutral/protocol.js";
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
export type Signal<T> = Writable<T> & (() => T) & {
  /** Create a callback that writes this value when invoked. */
  setTo(value: T): () => void;
};

export type GraphNeeds = GraphDefinition | readonly GraphDefinition[] | Readonly<Record<string, GraphDefinition>>;

/** Normalize one, many, or named graph dependencies for internal definitions. */
export function graphNeeds(needs?: GraphNeeds): GraphDefinition[] {
  if (!needs) return [];
  if (Array.isArray(needs)) return [...needs];
  if ("id" in needs && "kind" in needs) return [needs as GraphDefinition];
  return Object.values(needs);
}

let writeTrace: TraceToken | undefined;

export function currentWriteTrace(): TraceToken | undefined {
  return writeTrace;
}

export function withWriteTrace<T>(trace: TraceToken, run: () => T): T {
  const previous = writeTrace;
  writeTrace = trace;
  try {
    return run();
  } finally {
    writeTrace = previous;
  }
}

const dirty = new Set<Computed<any>>(),
  notifications = new Set<() => void>();
let activeReads: Set<Readable<unknown>> | undefined;

export function trackReads<T>(read: () => T) {
  const previous = activeReads;
  const sources = new Set<Readable<unknown>>();
  activeReads = sources;
  try {
    return { value: read(), sources };
  } finally {
    activeReads = previous;
  }
}

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
type StateOptions<T> = {
  id: string;
  initial: T;
  scope?: "application" | "view";
};

export function state<T>(def: StateOptions<T>): Signal<T> {
  let node!: Signal<T>;
  node = createState(def, Object.assign(() => node.get(), {
    setTo: (value: T) => () => node.set(value),
  }));
  return node;
}

/** Internal plain writable node for APIs whose public value is not callable. */
export function stateObject<T>(def: StateOptions<T>): Writable<T> {
  return createState(def, {});
}

/** @deprecated Use state; it now provides the same callable writable value. */
export function signal<T>(def: StateOptions<T>): Signal<T> {
  return state(def);
}

function createState<T, Target extends object>(def: StateOptions<T>, target: Target) {
  let value = def.initial,
    disposed = false;
  const node = Object.assign<Target, Writable<T>>(target, {
    id: def.id,
    kind: "state" as const,
    runtime: "browser" as const,
    metadata: { scope: def.scope ?? "application" },
    _children: new Set(),
    _listeners: new Set(),
    get() {
      activeReads?.add(node);
      return value;
    },
    set(next: T) {
      if (disposed) throw new Error(`Disposed state: ${def.id}`);
      if (!Object.is(next, value)) {
        value = next;
        if (writeTrace) node._trace = writeTrace;
        notify(node);
      }
    },
    update(fn: (value: T) => T) {
      node.set(fn(value));
    },
    subscribe(fn: () => void) {
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
  });
  return node;
}
export interface Computed<T> extends Readable<T> {
  (): T;
  dirty: boolean;
  recompute(): void;
}
export type DerivedFrom = Readable<any> | readonly Readable<any>[];
export type DerivedValues<From extends DerivedFrom> = From extends Readable<infer Value>
  ? [Value]
  : From extends readonly Readable<any>[]
    ? { [K in keyof From]: From[K] extends Readable<infer Value> ? Value : never }
    : never;

type DeriveOptions<From extends DerivedFrom, T> = {
  id: string;
  from: From;
  compute: (...values: DerivedValues<From>) => T;
};

export function derive<const From extends DerivedFrom, T>(
  id: string, from: From, compute: DeriveOptions<From, T>["compute"],
): Computed<T>;
export function derive<const From extends DerivedFrom, T>(
  options: DeriveOptions<From, T>,
): Computed<T>;
export function derive<const From extends DerivedFrom, T>(
  ...args: [DeriveOptions<From, T>] | [string, From, DeriveOptions<From, T>["compute"]]
): Computed<T> {
  const def = args.length === 1
    ? args[0]
    : { id: args[0], from: args[1], compute: args[2] };
  const sources: readonly Readable<any>[] = Array.isArray(def.from)
    ? def.from
    : [def.from as Readable<any>];
  let value: T,
    ready = false,
    computing = false,
    disposed = false;
  let node!: Computed<T>;
  node = Object.assign(() => node.get(), {
    id: def.id,
    kind: "derived" as const,
    runtime: "browser" as const,
    dependencies: sources,
    dirty: true,
    _children: new Set<Computed<any>>(),
    _listeners: new Set<() => void>(),
    recompute() {
      if (!node.dirty || disposed) return;
      if (computing) throw new Error(`ARC-WEB-204 derived cycle: ${node.id}`);
      computing = true;
      try {
        const next = def.compute(...(sources.map((d) => d.get()) as any));
        const changed = !ready || !Object.is(next, value);
        node._trace = sources.find((d) => d._trace)?._trace;
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
      const previous = activeReads;
      previous?.add(node);
      if (node.dirty) {
        activeReads = undefined;
        try {
          node.recompute();
        } finally {
          activeReads = previous;
        }
      }
      return value!;
    },
    subscribe(fn: () => void) {
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
      for (const dep of sources) dep._children.delete(node);
      for (const fn of node._listeners) notifications.delete(fn);
      node._listeners.clear();
      node._children.clear();
    },
  });
  for (const dep of sources) {
    if (!dep?._children)
      throw new Error(`ARC-WEB-202 invalid reactive dependency: ${def.id}`);
    dep._children.add(node);
  }
  const previous = activeReads;
  activeReads = undefined;
  try {
    node.recompute();
  } catch (error) {
    node.dispose();
    throw error;
  } finally {
    activeReads = previous;
  }
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
