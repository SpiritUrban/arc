export type ScalarInputType = "string" | "number" | "integer" | "boolean";

export function isNumericInputType(type: unknown): type is "number" | "integer" {
  return type === "number" || type === "integer";
}

export function isScalarInputType(type: unknown): type is ScalarInputType {
  return type === "string" || type === "boolean" || isNumericInputType(type);
}

export function decodeInputScalar(value: string, type: unknown): string | number | boolean {
  if (isNumericInputType(type) && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (type === "boolean" && (value === "true" || value === "false")) return value === "true";
  return value;
}

export function decodeInputFields(
  entries: Iterable<readonly [string, string]>,
  fields: Readonly<Record<string, { type?: unknown }>>,
  { route = false } = {},
): Record<string, string | number | boolean> {
  const values: Array<readonly [string, string | number | boolean]> = [];
  for (const [name, value] of entries) {
    const type = Object.hasOwn(fields, name) ? fields[name]?.type : undefined;
    if (route && !isScalarInputType(type)) continue;
    values.push([name, decodeInputScalar(value, type)]);
  }
  return Object.fromEntries(values);
}
