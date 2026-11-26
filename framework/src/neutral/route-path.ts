type RouteParam<Segment extends string> = Segment extends `:${infer Name}` ? Name : never;
type RouteParams<Pattern extends string> =
  Pattern extends `${infer Segment}/${infer Rest}`
    ? RouteParam<Segment> | RouteParams<Rest>
    : RouteParam<Pattern>;

/** Build a URL path from a route pattern and its raw parameter values. */
export function routePath<const Pattern extends string>(
  pattern: Pattern,
  params: Record<string extends Pattern ? string : RouteParams<Pattern>, string | number>,
): string {
  const values: Readonly<Record<string, string | number | undefined>> = params;
  return pattern.split("/").map((segment) => {
    if (!segment.startsWith(":")) return segment;
    const name = segment.slice(1);
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (value === undefined || value === "") {
      throw new TypeError(`Missing route parameter: ${name}`);
    }
    return encodeURIComponent(value);
  }).join("/");
}
