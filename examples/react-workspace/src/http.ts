export class ApiError extends Error {
  readonly fields: string[];

  constructor(code: string, fields: string[] = []) {
    super(code);
    this.fields = fields;
  }
}

export async function readResponse(response: Response): Promise<unknown> {
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error, body.fields);
  return body;
}
