import { graphlib, layout } from "@dagrejs/dagre";
import type { ArchitectureIR } from "./neutral/graph.js";

const filters = ["all", "browser", "server", "boundaries"] as const;

export function standLayouts(graph: ArchitectureIR) {
  const boundaryIds = new Set(
    graph.edges
      .filter((edge) => edge.kind === "REMOTE_CALLS")
      .flatMap((edge) => [edge.from, edge.to]),
  );

  return Object.fromEntries(
    filters.map((filter) => {
      const diagram = new graphlib.Graph({ multigraph: true }).setGraph({
        rankdir: "LR",
        ranksep: 88,
        nodesep: 24,
        edgesep: 16,
        marginx: 24,
        marginy: 24,
      });
      const nodes = graph.nodes.filter(
        (node) =>
          filter === "all" ||
          (filter === "boundaries"
            ? boundaryIds.has(node.id)
            : node.runtime === filter),
      );
      for (const node of nodes) {
        const subtitle = [node.kind, node.scope].filter(Boolean).join(" · ");
        const width = Math.max(
          156,
          Math.max(node.id.length, subtitle.length) * 8 + 24,
        );
        diagram.setNode(node.id, { width, height: 52 });
      }
      const edges = graph.edges.filter(
        (edge) => diagram.hasNode(edge.from) && diagram.hasNode(edge.to),
      );
      edges.forEach((edge, index) =>
        diagram.setEdge(edge.from, edge.to, {}, String(index)),
      );
      if (nodes.length) layout(diagram);
      return [
        filter,
        {
          width: diagram.graph().width ?? 1,
          height: diagram.graph().height ?? 1,
          nodes: nodes.map(({ id, kind, runtime, scope }) => {
            const { x, y, width, height } = diagram.node(id);
            return {
              id,
              kind,
              runtime,
              scope,
              x: x - width / 2,
              y: y - height / 2,
              width,
              height,
            };
          }),
          edges: edges.map((edge, index) => ({
            ...edge,
            points: diagram.edge(edge.from, edge.to, String(index)).points,
          })),
        },
      ];
    }),
  );
}
