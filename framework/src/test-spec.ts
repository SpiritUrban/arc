import type { Application } from "./core.js";
export type Matcher = unknown;
export interface StandTestSpec {
  version: 1;
  name: string;
  operation: string;
  input: unknown;
  expected: Matcher;
  request?: { authorization?: string; headers?: Record<string, string> };
  setup?: string;
  reset?: string;
}
export function matches(actual: unknown, expected: Matcher): boolean {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    const rule = expected as any;
    if (Object.hasOwn(rule, "$match")) {
      switch (rule.$match) {
        case "any":
          return true;
        case "uuid":
          return (
            typeof actual === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              actual,
            )
          );
        case "iso-date":
          return (
            typeof actual === "string" &&
            /^\d{4}-\d\d-\d\dT/.test(actual) &&
            Number.isFinite(Date.parse(actual))
          );
        case "type":
          return typeof actual === rule.type;
        default:
          return false;
      }
    }
    if (!actual || typeof actual !== "object" || Array.isArray(actual))
      return false;
    // Object specs match a subset, allowing outputs to add fields.
    return Object.entries(rule).every(
      ([key, value]) =>
        Object.hasOwn(actual, key) && matches((actual as any)[key], value),
    );
  }
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((v, i) => matches(actual[i], v))
    );
  return Object.is(actual, expected);
}
export async function runTestSpec(
  app: Application,
  spec: StandTestSpec,
  hooks: Record<string, () => void | Promise<void>> = {},
) {
  try {
    if (spec.setup) {
      if (!hooks[spec.setup])
        throw new Error(`Unknown setup hook: ${spec.setup}`);
      await hooks[spec.setup]();
    }
    const request = spec.request
      ? new Request("http://localhost", {
          headers: {
            ...spec.request.headers,
            ...(spec.request.authorization
              ? { authorization: spec.request.authorization }
              : {}),
          },
        })
      : undefined;
    const actual = await app.execute(spec.operation, spec.input, { request });
    return { name: spec.name, passed: matches(actual, spec.expected), actual };
  } finally {
    if (spec.reset) {
      if (!hooks[spec.reset])
        throw new Error(`Unknown reset hook: ${spec.reset}`);
      await hooks[spec.reset]();
    }
  }
}
