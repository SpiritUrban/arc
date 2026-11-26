export function decodeInputScalar(value: string, type: unknown): string | number | boolean {
  if ((type === "number" || type === "integer") && value.trim() !== "") return Number(value);
  if (type === "boolean" && (value === "true" || value === "false")) return value === "true";
  return value;
}
