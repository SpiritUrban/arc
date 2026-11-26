import { routeParameterName } from "./route-path.js";

export { routeParameterNames as pageParamNames } from "./route-path.js";

export function matchPagePath(pattern: string, pathname: string): Record<string, string> | undefined {
  const parts = pattern.split("/");
  const segments = pathname.split("/");
  if (parts.length !== segments.length) return;
  const params: [string, string][] = [];
  for (const [index, part] of parts.entries()) {
    const segment = segments[index];
    const name = routeParameterName(part);
    if (name === undefined) {
      if (part !== segment) return;
    } else {
      if (!segment) return;
      try {
        params.push([name, decodeURIComponent(segment)]);
      } catch {
        return;
      }
    }
  }
  return Object.fromEntries(params);
}

export function comparePagePaths(left: string, right: string) {
  const a = left.split("/");
  const b = right.split("/");
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const specificity =
      Number(routeParameterName(a[index]) !== undefined) -
      Number(routeParameterName(b[index]) !== undefined);
    if (specificity) return specificity;
  }
  return 0;
}
