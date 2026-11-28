import type { OperationContract } from "./contracts.js";
import { isScalarInputType } from "./input-scalar.js";

type RouteParam<Segment extends string> = Segment extends `:${infer Name}` ? Name : never;
export type RouteParamNames<Pattern extends string> =
  string extends Pattern ? string :
  Pattern extends `${infer Segment}/${infer Rest}`
    ? RouteParam<Segment> | RouteParamNames<Rest>
    : RouteParam<Pattern>;

type RouteParamValue = string | number | boolean;
type ScalarInputKeys<Input> = {
  [Key in keyof Input]-?: NonNullable<Input[Key]> extends RouteParamValue ? Key : never;
}[keyof Input];

export type ContractRoutePath<Path extends string, Input> =
  string extends Path ? Path :
  Exclude<RouteParamNames<Path>, ScalarInputKeys<Input>> extends never ? Path : never;

/** Build a URL path from a route pattern and its raw parameter values. */
export function routePath<const Pattern extends string>(
  pattern: Pattern,
  params: Record<RouteParamNames<Pattern>, RouteParamValue>,
): string {
  const values: Readonly<Record<string, RouteParamValue | undefined>> = params;
  return interpolateRoutePath(pattern, (name) =>
    Object.hasOwn(values, name) ? values[name] : undefined,
  );
}

export function interpolateRoutePath(
  pattern: string,
  readParam: (name: string) => unknown,
): string {
  return mapRoutePath(pattern, (name) => {
    const value = readParam(name);
    if (value === undefined || value === "") {
      throw new TypeError(`Missing route parameter: ${name}`);
    }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new TypeError(`Invalid route parameter: ${name} must be a string, number or boolean`);
    }
    if (value === "." || value === "..") {
      throw new TypeError(`Invalid route parameter: ${name} is a dot segment`);
    }
    return encodeURIComponent(value);
  });
}

export function mapRoutePath(
  pattern: string,
  mapParam: (name: string) => string,
  mapLiteral?: (segment: string) => string,
): string {
  return pattern.split("/").map((segment) => {
    const name = routeParameterName(segment);
    return name === undefined ? (mapLiteral?.(segment) ?? segment) : mapParam(name);
  }).join("/");
}

export function routeParameterName(segment: string): string | undefined {
  return segment.startsWith(":") ? segment.slice(1) : undefined;
}

export function routeParameterNames(pattern: string): string[] {
  return pattern.split("/").map(routeParameterName).filter((name) => name !== undefined);
}

export function decodeRouteParams(entries: Iterable<readonly [string, string]>): Record<string, string> {
  const params = new Map<string, string>();
  for (const [name, segment] of entries) {
    const value = decodeURIComponent(segment);
    const previous = params.get(name);
    if (previous !== undefined && previous !== value) {
      throw new URIError(`Conflicting route parameter: ${name}`);
    }
    params.set(name, value);
  }
  return Object.fromEntries(params);
}

export function validateContractRoutePath(path: string, contract: OperationContract): void {
  const properties = contract.input.json.properties ?? {};
  for (const name of routeParameterNames(path)) {
    if (!Object.hasOwn(properties, name)) {
      throw new TypeError(`HTTP route ${path} parameter "${name}" is missing from ${contract.id} input`);
    }
    if (!isScalarInputType(properties[name]?.type)) {
      throw new TypeError(`HTTP route ${path} parameter "${name}" must be scalar in ${contract.id} input`);
    }
  }
}
