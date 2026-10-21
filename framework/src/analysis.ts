import type { ArchitectureIR } from "./core.js";
/** All estimates are declared metadata plus structural derivation; no source-body inspection. */
export function analyzeGraph(ir: ArchitectureIR) {
  const byId = new Map(ir.nodes.map((n) => [n.id, n]));
  const edges = ir.edges.filter((e) =>
    ["DEPENDS_ON", "CALLS"].includes(e.kind),
  );
  const deps = (id: string) =>
    edges.filter((e) => e.from === id).map((e) => e.to);
  const closure = (id: string, reverse = false) => {
    const seen = new Set<string>();
    const visit = (key: string) => {
      for (const e of edges) {
        const next = reverse
          ? e.to === key
            ? e.from
            : undefined
          : e.from === key
            ? e.to
            : undefined;
        if (next && !seen.has(next)) {
          seen.add(next);
          visit(next);
        }
      }
    };
    visit(id);
    return [...seen];
  };
  const estimate = (id: string, seen = new Set<string>()): number | null => {
    if (seen.has(id)) return null;
    const n = byId.get(id);
    if (!n) return null;
    const next = new Set(seen).add(id);
    const children = deps(id).map((dep) => estimate(dep, next));
    if (n.estimateMs == null || children.some((x) => x === null)) return null;
    return n.estimateMs + Math.max(0, ...(children as number[]));
  };
  const warnings: { code: string; node: string; message: string }[] = [];
  const nodes = ir.nodes.map((node) => {
    const path = estimate(node.id),
      dependencies = closure(node.id),
      dependents = closure(node.id, true);
    if (node.kind === "operation" && node.estimateMs == null)
      warnings.push({
        code: "MISSING_ESTIMATE",
        node: node.id,
        message: "No declared operation estimate",
      });
    if (node.budgetMs != null && path != null && path > node.budgetMs)
      warnings.push({
        code: "BUDGET_EXCEEDED",
        node: node.id,
        message: `Declared lower-bound path ${path}ms exceeds budget ${node.budgetMs}ms`,
      });
    if (node.scope === "request" && !dependencies.length)
      warnings.push({
        code: "REQUEST_SCOPE_REVIEW",
        node: node.id,
        message: "Check whether this independent resource needs request scope",
      });
    return {
      id: node.id,
      declaredEstimateMs: node.estimateMs ?? null,
      compilerDerivedCriticalPathMs: path,
      estimateModel:
        "declared-node-cost + max(dependency/call path); calls may actually be sequential",
      fanOut: deps(node.id).length,
      dependencyCount: dependencies.length,
      dependents,
      blastRadius: dependents.filter(
        (id) => byId.get(id)?.kind === "operation",
      ),
      budgetMs: node.budgetMs ?? null,
    };
  });
  return { nodes, warnings };
}
