import type { GraphDefinition } from "../neutral/graph.js";

const targets = new WeakMap<object, GraphDefinition>();

export function withEventTrigger<Handler extends (...args: never[]) => unknown>(
  handler: Handler, target: GraphDefinition,
): Handler {
  targets.set(handler, target);
  return handler;
}

export function eventTrigger(handler: object): GraphDefinition | undefined {
  return targets.get(handler);
}
