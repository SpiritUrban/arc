import { Schema, type Infer } from "../schema.js";
export type Result<T = unknown, E extends string = string> =
  { ok: true; value: T } | { ok: false; error: E; details?: unknown };
export const ok = <T>(value: T): { ok: true; value: T } => ({
  ok: true,
  value,
});
export const error = <E extends string>(
  code: E,
  details?: unknown,
): { ok: false; error: E; details?: unknown } => ({
  ok: false,
  error: code,
  details,
});
export class Fault extends Error {
  constructor(
    public code: string,
    public status = 500,
    public details?: unknown,
  ) {
    super(code);
  }
}
export type ErrorDefinition =
  number | { status: number; details?: Schema<any>; field?: string; updateFromDetails?: true };
export type ErrorContracts = Record<string, ErrorDefinition>;
export const errorStatus = (definition: ErrorDefinition) =>
  typeof definition === "number" ? definition : definition.status;
export const errorDetailsSchema = (definition: ErrorDefinition) =>
  typeof definition === "number" ? undefined : definition.details;
export type BusinessError<E extends ErrorContracts> = {
  [K in keyof E & string]: E[K] extends { details: Schema<infer D> }
    ? { ok: false; error: K; details: D }
    : { ok: false; error: K; details?: unknown };
}[keyof E & string];
export type OperationResult<O, E extends ErrorContracts> =
  { ok: true; value: O } | BusinessError<E>;
export type Fail<E extends ErrorContracts> = <K extends keyof E & string>(
  code: K,
  ...details: E[K] extends { details: Schema<infer D> }
    ? [details: D]
    : [details?: unknown]
) => Extract<BusinessError<E>, { error: K }>;

export interface OperationContract<
  I = any,
  O = any,
  E extends ErrorContracts = ErrorContracts,
> {
  id: string;
  kind: "operation";
  runtime?: "server";
  input: Schema<I>;
  output: Schema<O>;
  errors: E;
  expose?: { web?: boolean };
}
export type OperationErrors<I, O, E extends ErrorContracts> = E & {
  [K in keyof E]: (number | { status: number; field?: Extract<keyof NoInfer<I>, string> }) &
    (E[K] extends { updateFromDetails: true } ? { details: Schema<NoInfer<O>> } : unknown);
};

export function operationContract<
  I,
  O,
  const E extends ErrorContracts = {},
  Input extends Schema<I> = Schema<I>,
  Output extends Schema<O> = Schema<O>,
>(def: {
  id: string;
  input: Schema<I> & Input;
  output: Schema<O> & Output;
  errors?: OperationErrors<I, O, E>;
  expose?: { web?: boolean };
}): OperationContract<I, O, E> & { readonly input: Input; readonly output: Output } {
  return Object.freeze({
    kind: "operation",
    runtime: "server",
    errors: {} as E,
    ...def,
  });
}
