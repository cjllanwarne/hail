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

// Lays out nodes top-to-bottom using d3-dag's dagre-compatible API (see d3-dag's README "Quick
// Start with React Flow" section) — a drop-in replacement for the real `dagre` package that
// avoids adding a second, less type-safe layout dependency.
function layout(nodes: DagNode[], edges: DagEdge[]): { flowNodes: Node[]; flowEdges: Edge[] } {
  const grf = new dagre.graphlib.Graph();
  // d3-dag's default ("medium") quality preset is quadratic-ish in node count — ~20s+ of
  // synchronous main-thread work (freezing the tab, not just "slow") for a batch/build with a few
  // thousand jobs, which a real CI build can easily have. "fast" scales close to linearly and is
  // still a perfectly reasonable layout for this use case.
  grf.setGraph({ rankdir: 'TB', quality: 'fast' });
  grf.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) {
    grf.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  // A DAG built from real job-dependency data can reference a parent id that isn't itself in the
  // node set (e.g. this page is a paginated/filtered slice of the full graph) — skip those edges
  // rather than letting d3-dag throw on an edge to an unknown node.
  const nodeIds = new Set(nodes.map((n) => n.id));
  const validEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  for (const edge of validEdges) {
    grf.setEdge(edge.source, edge.target);
  }
  dagre.layout(grf);

  const flowNodes: Node[] = nodes.map((node) => {
    const pos = grf.node(node.id) as { x: number; y: number };
    return {
      id: node.id,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: { label: node.label },
      style: node.color ? { background: node.color, width: NODE_WIDTH } : { width: NODE_WIDTH },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
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
