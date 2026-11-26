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
  return pattern.split("/").map((segment) => {
    if (!segment.startsWith(":")) return segment;
    return encodeURIComponent(readParam(segment.slice(1)));
  }).join("/");
}
