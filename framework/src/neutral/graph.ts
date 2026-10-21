export type RuntimeTarget = "browser" | "server" | "shared";
export type NodeKind =
  | "operation"
  | "resource"
  | "http-route"
  | "queue"
  | "worker"
  | "schedule"
  | "effect"
  | "state"
  | "derived"
  | "web-resource"
  | "action"
  | "view"
  | "binding"
  | "remote-endpoint"
  | "contract"
  | "pure";
export type EdgeKind =
  | "DEPENDS_ON"
  | "ROUTES_TO"
  | "CALLS"
  | "EMITS"
  | "CONSUMES"
  | "TRIGGERS"
  | "DERIVES"
  | "BINDS"
  | "REMOTE_CALLS"
  | "INVALIDATES";
export interface GraphNode {
  id: string;
  kind: NodeKind;
  runtime?: RuntimeTarget;
  [key: string]: any;
}
export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  name?: string;
}
export interface ArchitectureIR {
  version: 3;
  nodes: GraphNode[];
  edges: GraphEdge[];
  routes: { method: string; path: string; operation: string; status: number }[];
  partitions?: Record<RuntimeTarget, string[]>;
  boundaries?: { from: string; to: string; transport: string }[];
  analysis?: ReturnType<typeof import("../analysis.js").analyzeGraph>;
}
export interface GraphDefinition {
  id: string;
  kind: NodeKind;
  runtime?: RuntimeTarget;
  dependencies?: readonly GraphDefinition[];
  relations?: { to: GraphDefinition; kind: EdgeKind }[];
  activate?: (telemetry?: any) => void;
  dispose?: () => void;
  metadata?: Record<string, any>;
  needs?: Record<string, GraphDefinition>;
  input?: any;
  output?: any;
  errors?: any;
  expose?: { web?: boolean };
}
export class Diagnostic extends Error {
  constructor(
    public code: string,
    public path: string[],
    message: string,
  ) {
    super(`${code}: ${message}\n${path.join(" → ")}`);
  }
}
const browserKinds = new Set([
  "state",
  "derived",
  "web-resource",
  "remote-endpoint",
  "action",
  "view",
  "binding",
]);
export function targetFor(node: {
  kind: NodeKind;
  runtime?: RuntimeTarget;
}): RuntimeTarget {
  return (
    node.runtime ??
    (browserKinds.has(node.kind)
      ? "browser"
      : ["contract", "pure"].includes(node.kind)
        ? "shared"
        : "server")
  );
}
function describe(def: GraphDefinition): GraphNode {
  return {
    id: def.id,
    kind: def.kind,
    runtime: targetFor(def),
    ...def.metadata,
    ...(def.kind === "operation"
      ? {
          input: def.input?.json,
          output: def.output?.json,
          errors: Object.fromEntries(
            Object.entries(def.errors ?? {}).map(([k, v]: any) => [
              k,
              typeof v === "number"
                ? { status: v }
                : { status: v.status, details: v.details?.json },
            ]),
          ),
          expose: def.expose ?? {},
        }
      : {}),
  };
}
export function compileArchitecture(
  roots: readonly GraphDefinition[],
  server?: ArchitectureIR,
): ArchitectureIR {
  const nodes = new Map<string, GraphNode>(
    (server?.nodes ?? []).map((n) => [n.id, { ...n, runtime: targetFor(n) }]),
  );
  const definitions = new Map<string, GraphDefinition>();
  const edges: GraphEdge[] = [...(server?.edges ?? [])];
  const addEdge = (e: GraphEdge) => {
    if (
      !edges.some(
        (x) => x.from === e.from && x.to === e.to && x.kind === e.kind,
      )
    )
      edges.push(e);
  };
  const visit = (def: GraphDefinition, path: string[] = []) => {
    if (!def || typeof def.id !== "string" || !def.id || !def.kind)
      throw new Diagnostic("ARC-WEB-202", path, "Invalid reactive dependency");
    if (path.includes(def.id))
      throw new Diagnostic(
        "ARC-WEB-204",
        [...path, def.id],
        "Declared reactive/dependency cycle",
      );
    const previous = definitions.get(def.id);
    if (previous && previous !== def)
      throw new Diagnostic(
        "ARC-WEB-205",
        [...path, def.id],
        "Duplicate node identity",
      );
    if (previous) return;
    const node = describe(def),
      existing = nodes.get(def.id);
    if (existing && def.kind !== "operation")
      throw new Diagnostic(
        "ARC-WEB-205",
        [...path, def.id],
        "Duplicate frontend/server identity",
      );
    if (existing && def.kind === "operation")
      for (const key of ["input", "output", "errors"])
        if (JSON.stringify(existing[key]) !== JSON.stringify(node[key]))
          throw new Diagnostic(
            "ARC-WEB-207",
            [...path, def.id],
            `Cross-runtime contract mismatch: ${key}`,
          );
    definitions.set(def.id, def);
    if (existing?.runtime === "server") return;
    if (!existing) nodes.set(def.id, node);
    const deps =
      def.dependencies ?? (Object.values(def.needs ?? {}) as GraphDefinition[]);
    for (const dep of deps) {
      visit(dep, [...path, def.id]);
      addEdge({
        from: def.kind === "derived" ? dep.id : def.id,
        to: def.kind === "derived" ? def.id : dep.id,
        kind: def.kind === "derived" ? "DERIVES" : "DEPENDS_ON",
      });
    }
    for (const relation of def.relations ?? []) {
      visit(relation.to, [...path, def.id]);
      addEdge({
        from: relation.kind === "BINDS" ? relation.to.id : def.id,
        to: relation.kind === "BINDS" ? def.id : relation.to.id,
        kind: relation.kind,
      });
    }
  };
  for (const root of roots) visit(root);
  for (const node of [...nodes.values()])
    if (node.kind === "operation")
      for (const side of ["input", "output"]) {
        const id = `contract:${node.id}:${side}`;
        if (nodes.has(id))
          throw new Diagnostic(
            "ARC-WEB-205",
            [node.id, id],
            "Reserved contract identity collision",
          );
        nodes.set(id, {
          id,
          kind: "contract",
          runtime: "shared",
          estimateMs: 0,
          schema: node[side],
        });
        addEdge({ from: node.id, to: id, kind: "DEPENDS_ON" });
        for (const boundary of edges.filter(
          (e) => e.kind === "REMOTE_CALLS" && e.to === node.id,
        ))
          addEdge({ from: boundary.from, to: id, kind: "DEPENDS_ON" });
      }
  for (const e of edges) {
    const from = nodes.get(e.from),
      to = nodes.get(e.to);
    if (!from || !to)
      throw new Diagnostic(
        "ARC-WEB-202",
        [e.from, e.to],
        "Missing graph endpoint",
      );
    if (e.kind === "REMOTE_CALLS") {
      if (
        from.runtime !== "browser" ||
        to.kind !== "operation" ||
        to.runtime !== "server" ||
        !to.expose?.web
      )
        throw new Diagnostic(
          "ARC-WEB-206",
          [e.from, e.to],
          "Remote operation is not explicitly web-exposed",
        );
    } else if (
      (from.runtime === "browser" && to.runtime === "server") ||
      (from.runtime === "shared" && to.runtime !== "shared") ||
      (from.runtime === "server" && to.runtime === "browser")
    )
      throw new Diagnostic(
        "ARC201",
        [
          `${from.id} [${from.kind}/${from.runtime}]`,
          `${to.id} [${to.kind}/${to.runtime}]`,
        ],
        "Runtime boundary violation. Use remote(serverOperation) or shared pure contracts.",
      );
  }
  const partitions: Record<RuntimeTarget, string[]> = {
    browser: [],
    server: [],
    shared: [],
  };
  for (const n of nodes.values()) partitions[n.runtime!].push(n.id);
  return {
    version: 3,
    nodes: [...nodes.values()],
    edges,
    routes: server?.routes ?? [],
    partitions,
    boundaries: edges
      .filter((e) => e.kind === "REMOTE_CALLS")
      .map((e) => ({ from: e.from, to: e.to, transport: "arc-internal-v1" })),
  };
}
export function graphModule<T extends { id: string; [key: string]: any }>(
  definition: T,
): T {
  return definition;
}

/** Logical application metadata, usable for a browser-only target without Node/DOM. */
export function graphApplication(options: {
  modules?: {
    id: string;
    web?: {
      nodes: GraphDefinition[];
      entry?: string;
      serverModules?: string[];
    };
  }[];
  web?: { nodes: GraphDefinition[]; entry?: string; serverModules?: string[] };
}) {
  const nodes = [
    ...(options.web?.nodes ?? []),
    ...(options.modules ?? []).flatMap((m) => m.web?.nodes ?? []),
  ];
  let ir: ArchitectureIR | undefined;
  return {
    kind: "arc-graph" as const,
    compile() {
      ir = compileArchitecture(nodes);
      return ir;
    },
    graph() {
      return ir ?? this.compile();
    },
    webNodes: () => nodes,
    webConfig: () =>
      options.web ?? options.modules?.find((m) => m.web?.entry)?.web,
  };
}
