import type { GraphDefinition } from "../neutral/graph.js";

const targets = new WeakMap<object, GraphDefinition>();
const owners = new WeakMap<object, GraphDefinition>();
const references = new WeakMap<object, () => unknown>();

export function withEventTrigger<Binding extends object>(
  binding: Binding, target: GraphDefinition,
): Binding {
  targets.set(binding, target);
  owners.set(target, target);
  return binding;
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
  if (owner && (typeof owner === "object" || typeof owner === "function"))
    return targets.get(owner) ?? owners.get(owner);
}
