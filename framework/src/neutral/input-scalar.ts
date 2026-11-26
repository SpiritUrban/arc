export function isNumericInputType(type: unknown): type is "number" | "integer" {
  return type === "number" || type === "integer";
}

export function isScalarInputType(type: unknown): type is "string" | "number" | "integer" | "boolean" {
  return type === "string" || type === "boolean" || isNumericInputType(type);
}

export function decodeInputScalar(value: string, type: unknown): string | number | boolean {
  if (isNumericInputType(type) && value.trim() !== "") return Number(value);
  if (type === "boolean" && (value === "true" || value === "false")) return value === "true";
  return value;
}
