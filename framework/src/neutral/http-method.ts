export function acceptsJsonBody(method: string): boolean {
  return method !== "GET" && method !== "DELETE" && method !== "HEAD";
}
