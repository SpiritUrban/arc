export class ValidationError extends Error {
  constructor(public issues: string[]) {
    super(issues.join("; "));
  }
}
export type Infer<S> = S extends Schema<infer T> ? T : never;
export class Schema<T> {
  constructor(
    public json: Record<string, any>,
    private check: (value: unknown, path: string) => T,
    public sample: () => T,
  ) {}
  parse(value: unknown, path = "$"): T {
    return this.check(value, path);
  }
  optional(): Schema<T | undefined> {
    return new Schema(
      { ...this.json, optional: true },
      (v, p) => (v === undefined ? undefined : this.parse(v, p)),
      this.sample,
    );
  }
  array(): Schema<T[]> {
    return array(this);
  }
}
const fail = (path: string, message: string): never => {
  throw new ValidationError([`${path}: ${message}`]);
};
export const string = (
  options: { min?: number; max?: number; format?: "uuid" | "email" } = {},
) =>
  new Schema<string>(
    {
      type: "string",
      minLength: options.min,
      maxLength: options.max,
      format: options.format,
    },
    (v, p) => {
      if (typeof v !== "string") return fail(p, "expected string");
      if (v.length < (options.min ?? 0) || v.length > (options.max ?? Infinity))
        return fail(p, "invalid length");
      if (
        options.format === "uuid" &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          v,
        )
      )
        return fail(p, "expected UUID");
      if (options.format === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))
        return fail(p, "expected email");
      return v;
    },
    () =>
      options.format === "uuid"
        ? "00000000-0000-4000-8000-000000000001"
        : options.format === "email"
          ? "demo@example.com"
          : "example".padEnd(options.min ?? 0, "x").slice(0, options.max),
  );
export const number = (
  options: { min?: number; max?: number; integer?: boolean } = {},
) =>
  new Schema<number>(
    {
      type: options.integer ? "integer" : "number",
      minimum: options.min,
      maximum: options.max,
    },
    (v, p) =>
      typeof v === "number" &&
      Number.isFinite(v) &&
      (!options.integer || Number.isInteger(v)) &&
      v >= (options.min ?? -Infinity) &&
      v <= (options.max ?? Infinity)
        ? v
        : fail(p, "invalid number"),
    () => Math.max(options.min ?? 0, Math.min(1, options.max ?? 1)),
  );
export const boolean = () =>
  new Schema<boolean>(
    { type: "boolean" },
    (v, p) => (typeof v === "boolean" ? v : fail(p, "expected boolean")),
    () => true,
  );
export const literal = <const T extends string | number | boolean>(value: T) =>
  new Schema<T>(
    { const: value, type: typeof value },
    (v, p) => (v === value ? value : fail(p, `expected ${value}`)),
    () => value,
  );
export const array = <T>(item: Schema<T>) =>
  new Schema<T[]>(
    { type: "array", items: item.json },
    (v, p) =>
      Array.isArray(v)
        ? v.map((x, i) => item.parse(x, `${p}[${i}]`))
        : fail(p, "expected array"),
    () => [item.sample()],
  );
type Shape = Record<string, Schema<any>>;
type ObjectType<S extends Shape> = {
  [K in keyof S as undefined extends Infer<S[K]> ? never : K]: Infer<S[K]>;
} & {
  [K in keyof S as undefined extends Infer<S[K]> ? K : never]?: Infer<S[K]>;
};
export const object = <S extends Shape>(shape: S): Schema<ObjectType<S>> =>
  new Schema(
    {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(shape).map(([k, s]) => [k, s.json]),
      ),
      required: Object.keys(shape).filter((k) => !shape[k].json.optional),
      additionalProperties: false,
    },
    (v, p) => {
      if (!v || typeof v !== "object" || Array.isArray(v))
        return fail(p, "expected object");
      for (const k of Object.keys(v))
        if (!Object.hasOwn(shape, k)) fail(`${p}.${k}`, "unknown property");
      const result: Record<string, unknown> = {};
      const issues: string[] = [];
      for (const [k, s] of Object.entries(shape)) {
        try {
          const value = s.parse((v as any)[k], `${p}.${k}`);
          if (value !== undefined) result[k] = value;
        } catch (e) {
          if (e instanceof ValidationError) issues.push(...e.issues);
          else throw e;
        }
      }
      if (issues.length) throw new ValidationError(issues);
      return result as ObjectType<S>;
    },
    () =>
      Object.fromEntries(
        Object.entries(shape)
          .filter(([, s]) => !s.json.optional)
          .map(([k, s]) => [k, s.sample()]),
      ) as ObjectType<S>,
  );
export const s = {
  string,
  number,
  boolean,
  literal,
  array,
  object,
  uuid: () => string({ format: "uuid" }),
  email: () => string({ format: "email" }),
  int: (o: { min?: number; max?: number } = {}) =>
    number({ ...o, integer: true }),
};
