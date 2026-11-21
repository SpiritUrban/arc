export function pageParamNames(pattern: string) {
  return pattern.split("/").filter((part) => part.startsWith(":")).map((part) => part.slice(1));
}

export function matchPagePath(pattern: string, pathname: string): Record<string, string> | undefined {
  const parts = pattern.split("/");
  const segments = pathname.split("/");
  if (parts.length !== segments.length) return;
  const params: [string, string][] = [];
  for (const [index, part] of parts.entries()) {
    const segment = segments[index];
    if (!part.startsWith(":")) {
      if (part !== segment) return;
    } else {
      if (!segment) return;
      try {
        params.push([part.slice(1), decodeURIComponent(segment)]);
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
    const specificity = Number(a[index].startsWith(":")) - Number(b[index].startsWith(":"));
    if (specificity) return specificity;
  }
  return 0;
}
