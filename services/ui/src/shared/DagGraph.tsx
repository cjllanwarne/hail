import { useMemo, useCallback } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Position } from '@xyflow/react';
import type { Node, Edge, NodeMouseHandler } from '@xyflow/react';
import { dagre } from 'd3-dag';
import '@xyflow/react/dist/style.css';

// Generic node/edge DAG viewer, built on @xyflow/react for pan/zoom/click interaction and
// d3-dag's dagre-compatible layout API for node placement (see personal-rfcs/react-dag-viewer-rfc.md
// for the design discussion this grew out of). Deliberately has no knowledge of what a node/edge
// represents (a CI build step, a raw batch job, ...) — a host component builds the generic
// {id, label, color} / {source, target} shape from its own domain data and passes it in.

export interface DagNode {
  id: string;
  label: string;
  // CSS color for the node's background, e.g. a job/step state color. Defaults to xyflow's own
  // default node styling if omitted.
  color?: string;
  // Relative weight, e.g. a collapsed group's job count. Node height scales linearly with this,
  // capped at MAX_SCALE. Defaults to 1.
  weight?: number;
}

export interface DagEdge {
  source: string;
  target: string;
}

interface Props {
  nodes: DagNode[];
  edges: DagEdge[];
  onNodeClick?: (id: string) => void;
}

const NODE_WIDTH = 172;
const NODE_HEIGHT = 36;
const MAX_SCALE = 15;

function nodeSize(weight: number | undefined): { width: number; height: number } {
  const scale = Math.min(weight ?? 1, MAX_SCALE);
  return { width: NODE_WIDTH, height: NODE_HEIGHT * scale };
}

// Drops any edge u->v for which a longer path from u to v already exists through some other node
// — the standard "transitive reduction" of a DAG (e.g. A->B->C plus a direct A->C: the A->C edge
// is redundant and dropped). This is the minimum-equivalent-graph operation for a DAG and is
// unique/well-defined, unlike for a general graph. Doesn't reduce node count (so doesn't help
// MAX_RENDERABLE_NODES-style caps), but cuts real visual clutter — job/step DAGs commonly have
// exactly this "shortcut" pattern (e.g. a fan-in cleanup step depending on both an early setup
// step and everything downstream of it) — and fewer edges also means less work for the sugiyama
// decrossing step below.
function transitiveReduction(nodeIds: string[], edges: DagEdge[]): DagEdge[] {
  const children = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const e of edges) {
    children.get(e.source)?.push(e.target);
  }

  // Reachability sets, memoized per node — safe as plain recursion (no cycle guard needed) since
  // the input is a DAG. Computed lazily/only for nodes actually queried.
  const reachCache = new Map<string, Set<string>>();
  function reachableFrom(id: string): Set<string> {
    const cached = reachCache.get(id);
    if (cached) return cached;
    const reachable = new Set<string>();
    for (const child of children.get(id) ?? []) {
      reachable.add(child);
      for (const r of reachableFrom(child)) reachable.add(r);
    }
    reachCache.set(id, reachable);
    return reachable;
  }

  return edges.filter((e) => {
    const siblings = (children.get(e.source) ?? []).filter((c) => c !== e.target);
    const hasLongerPath = siblings.some((c) => reachableFrom(c).has(e.target));
    return !hasLongerPath;
  });
}

// Lays out nodes top-to-bottom using d3-dag's dagre-compatible API (see d3-dag's README "Quick
// Start with React Flow" section) — a drop-in replacement for the real `dagre` package that
// avoids adding a second, less type-safe layout dependency.
function layout(nodes: DagNode[], edges: DagEdge[]): { flowNodes: Node[]; flowEdges: Edge[] } {
  const grf = new dagre.graphlib.Graph();
  // d3-dag's default ("medium") quality preset is quadratic-ish in node count — ~20s+ of
  // synchronous main-thread work (freezing the tab, not just "slow") for a batch/build with a few
  // thousand jobs, which a real CI build can easily have. "fast" scales close to linearly and is
  // still a perfectly reasonable layout for this use case.
  grf.setGraph({ rankdir: 'LR', quality: 'fast' });
  grf.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) {
    grf.setNode(node.id, nodeSize(node.weight));
  }
  // A DAG built from real job-dependency data can reference a parent id that isn't itself in the
  // node set (e.g. this page is a paginated/filtered slice of the full graph) — skip those edges
  // rather than letting d3-dag throw on an edge to an unknown node.
  const nodeIds = new Set(nodes.map((n) => n.id));
  const validEdges = transitiveReduction(
    nodes.map((n) => n.id),
    edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)),
  );
  for (const edge of validEdges) {
    grf.setEdge(edge.source, edge.target);
  }
  dagre.layout(grf);

  const flowNodes: Node[] = nodes.map((node) => {
    const pos = grf.node(node.id) as { x: number; y: number };
    const { width, height } = nodeSize(node.weight);
    return {
      id: node.id,
      position: { x: pos.x - width / 2, y: pos.y - height / 2 },
      data: { label: node.label },
      style: { width, height, ...(node.color ? { background: node.color } : {}) },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });
  const flowEdges: Edge[] = validEdges.map((edge) => ({
    id: `${edge.source}->${edge.target}`,
    source: edge.source,
    target: edge.target,
  }));
  return { flowNodes, flowEdges };
}

export function DagGraph({ nodes, edges, onNodeClick }: Props): JSX.Element {
  const { flowNodes, flowEdges } = useMemo(() => layout(nodes, edges), [nodes, edges]);

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      onNodeClick?.(node.id);
    },
    [onNodeClick],
  );

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodeClick={onNodeClick ? handleNodeClick : undefined}
        minZoom={0.05}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </ReactFlowProvider>
  );
}
