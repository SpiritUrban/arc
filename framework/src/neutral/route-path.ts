import type { OperationContract } from "./contracts.js";

type RouteParam<Segment extends string> = Segment extends `:${infer Name}` ? Name : never;
export type RouteParamNames<Pattern extends string> =
  string extends Pattern ? string :
  Pattern extends `${infer Segment}/${infer Rest}`
    ? RouteParam<Segment> | RouteParamNames<Rest>
    : RouteParam<Pattern>;

/** Build a URL path from a route pattern and its raw parameter values. */
export function routePath<const Pattern extends string>(
  pattern: Pattern,
  params: Record<RouteParamNames<Pattern>, string | number>,
): string {
  const values: Readonly<Record<string, string | number | undefined>> = params;
  return interpolateRoutePath(pattern, (name) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (value === undefined || value === "") {
      throw new TypeError(`Missing route parameter: ${name}`);
    }
    return value;
  });
}

export function interpolateRoutePath(
  pattern: string,
  readParam: (name: string) => string | number,
): string {
  return mapRoutePath(pattern, (name) => encodeURIComponent(readParam(name)));
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

function routeParameterName(segment: string): string | undefined {
  return segment.startsWith(":") ? segment.slice(1) : undefined;
}

export function routeParameterNames(pattern: string): string[] {
  return pattern.split("/").map(routeParameterName).filter((name) => name !== undefined);
}

export function validateContractRoutePath(path: string, contract: OperationContract): void {
  const properties = contract.input.json.properties ?? {};
  for (const name of routeParameterNames(path)) {
    if (!Object.hasOwn(properties, name)) {
      throw new TypeError(`HTTP route ${path} parameter "${name}" is missing from ${contract.id} input`);
    }
  }
}
