import type { GraphDefinition } from "../neutral/graph.js";

const targets = new WeakMap<object, GraphDefinition>();
const owners = new WeakSet<GraphDefinition>();
const references = new WeakMap<object, () => unknown>();

export function withEventTrigger<Handler extends (...args: never[]) => unknown>(
  handler: Handler, target: GraphDefinition,
): Handler {
  targets.set(handler, target);
  owners.add(target);
  return handler;
}

export function reactiveEvent<Handler extends (...args: never[]) => unknown>(
  handler: Handler, reference: () => unknown,
): Handler {
  references.set(handler, reference);
  return handler;
}

export function eventTrigger(handler: object): GraphDefinition | undefined {
  const target = targets.get(handler);
  if (target) return target;
  const owner = references.get(handler)?.();
  if (owner && (typeof owner === "object" || typeof owner === "function") &&
      owners.has(owner as GraphDefinition))
    return owner as GraphDefinition;
}
