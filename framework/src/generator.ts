import { Schema } from "./schema.js";
export interface InputCase {
  label: string;
  category: "sample" | "boundary" | "edge" | "invalid";
  value: unknown;
  valid: boolean;
}
function base(j: Record<string, any>): any {
  if (Object.hasOwn(j, "const")) return j.const;
  switch (j.type) {
    case "object":
      return Object.fromEntries(
        Object.entries(j.properties ?? {})
          .filter(([k]) => (j.required ?? []).includes(k))
          .map(([k, v]) => [k, base(v as any)]),
      );
    case "array":
      return [base(j.items)];
    case "boolean":
      return true;
    case "number":
    case "integer": {
      let n = Math.max(
        j.minimum ?? -Infinity,
        Math.min(1, j.maximum ?? Infinity),
      );
      if (j.type === "integer") n = Math.ceil(n);
      return n;
    }
    case "string":
      if (j.format === "uuid") return "00000000-0000-4000-8000-000000000001";
      if (j.format === "email")
        return "x".repeat(Math.max(5, j.minLength ?? 0) - 4) + "@b.c";
      return "x".repeat(j.minLength ?? Math.min(7, j.maxLength ?? 7));
    default:
      return null;
  }
}
function variations(
  j: Record<string, any>,
  path = "$",
): { label: string; category: InputCase["category"]; value: unknown }[] {
  const result: {
    label: string;
    category: InputCase["category"];
    value: unknown;
  }[] = [{ label: `${path}: sample`, category: "sample", value: base(j) }];
  const add = (
    label: string,
    value: unknown,
    category: InputCase["category"] = "boundary",
  ) => result.push({ label: `${path}: ${label}`, category, value });
  add("null", null, "invalid");
  add("wrong type", j.type === "string" ? 42 : "wrong-type", "invalid");
  if (j.optional) add("undefined", undefined, "edge");
  if (j.type === "number" || j.type === "integer") {
    for (const bound of [j.minimum, j.maximum])
      if (Number.isFinite(bound))
        for (const delta of [-1, 0, 1])
          add(`${bound}${delta >= 0 ? "+" : ""}${delta}`, bound + delta);
    add("zero", 0, "edge");
    add("fraction", 0.5, "edge");
    add("negative", -1, "edge");
  }
  if (j.type === "string") {
    add("empty", "");
    for (const length of [
      j.minLength === undefined ? undefined : j.minLength - 1,
      j.minLength,
      j.minLength === undefined ? undefined : j.minLength + 1,
      j.maxLength === undefined ? undefined : j.maxLength - 1,
      j.maxLength,
      j.maxLength === undefined ? undefined : j.maxLength + 1,
    ])
      if (Number.isInteger(length) && length >= 0 && length <= 100000)
        add(`length ${length}`, "x".repeat(length));
    add("unicode", "Привіт 🌍", "edge");
    add("control", "\u0000\n", "edge");
    if (j.format === "uuid")
      for (const v of [
        "not-a-uuid",
        "00000000-0000-4000-8000-00000000000g",
        "00000000-0000-4000-8000",
      ])
        add("malformed uuid", v, "invalid");
    if (j.format === "email")
      for (const v of ["name", "a@", "@example.com", "a b@example.com"])
        add("malformed email", v, "invalid");
  }
  if (j.type === "boolean") add("false", false, "edge");
  if (j.type === "array") {
    add("empty array", [], "edge");
    for (const c of variations(j.items, `${path}[0]`))
      add(c.label, [c.value], c.category);
  }
  if (j.type === "object") {
    const sample = base(j);
    add("empty object", {}, "edge");
    for (const [key, prop] of Object.entries(j.properties ?? {})) {
      const removed = { ...sample };
      delete removed[key];
      add(`missing ${key}`, removed, "edge");
      for (const c of variations(prop as any, `${path}.${key}`))
        add(c.label, { ...sample, [key]: c.value }, c.category);
    }
    add("unknown property", { ...sample, __invalid: true }, "invalid");
  }
  return result;
}
/** Deterministic corpus is separate from sampling strategy; a future random strategy can emit the same case model. */
export function generateCases(schema: Schema<any>): InputCase[] {
  const seen = new Set<string>();
  return variations(schema.json)
    .filter((c) => {
      const key = JSON.stringify(c.value) ?? "undefined";
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((c) => {
      let valid = true;
      try {
        schema.parse(c.value);
      } catch {
        valid = false;
      }
      return { ...c, valid };
    });
}
