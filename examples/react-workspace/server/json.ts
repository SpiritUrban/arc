import type { IncomingMessage, ServerResponse } from "node:http";
import type { ZodType } from "zod";

export function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

export async function readJson<T>(
  request: IncomingMessage,
  response: ServerResponse,
  schema: ZodType<T>,
): Promise<{ data: T } | undefined> {
  if (!request.headers["content-type"]?.includes("application/json")) {
    sendJson(response, 415, { error: "UNSUPPORTED_MEDIA_TYPE" });
    return;
  }
  let body: unknown;
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    sendJson(response, 400, { error: "INVALID_JSON" });
    return;
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const fields = [
      ...new Set(
        result.error.issues.flatMap(({ path }) =>
          typeof path[0] === "string" ? [path[0]] : [],
        ),
      ),
    ];
    sendJson(response, 400, { error: "VALIDATION_ERROR", fields });
    return;
  }
  return { data: result.data };
}
