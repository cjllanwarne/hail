import { useMemo } from 'react';
import { DagGraph } from '../../shared/DagGraph';
import type { DagNode, DagEdge } from '../../shared/DagGraph';
import type { JobGraphEntry, JobListEntry, JobState } from './useBatchData';

// Matches the state colors used by JobTimingChart's OUTCOME_COLORS and the batch-status
// SegmentedBar in pr.tsx (as hex, since SVG/inline-style `background` doesn't take Tailwind
// classes) — kept in sync by hand since there's no shared color-token module yet.
const JOB_STATE_COLORS: Record<JobState, string> = {
  Success: '#22c55e',
  Running: '#0ea5e9',
  Creating: '#7dd3fc',
  Ready: '#d4d4d8',
  Pending: '#e4e4e7',
  Failed: '#ef4444',
  Error: '#f97316',
  Cancelled: '#a1a1aa',
};

interface Props {
  jobs: JobListEntry[] | null;
  jobGraph: JobGraphEntry[];
  batchBaseUrl: string;
  batchId: number;
}

// Beyond a few hundred nodes, rendering one DOM node per job (xyflow doesn't virtualize) gets
// sluggish/unresponsive regardless of how fast the layout computation itself is — and a job-level
// graph is already visually unreadable well before this point anyway (a CI build with heavy
// split/cleanup fan-out can have thousands of raw jobs). Refuse to render past this rather than
// silently freezing the tab; step-level aggregation (see the RFC referenced above) is the real
// fix for CI-scale builds, not a higher cap here.
const MAX_RENDERABLE_NODES = 500;

function jobLabel(job_id: number, jobNameById: Map<number, string | null>): string {
  return jobNameById.get(job_id) ?? `Job ${job_id}`;
}

// Raw per-job dependency graph — one node per job (not aggregated by name/step), since collapsing
// splits/cleanup/log jobs into step-level nodes is a CI-specific concern that doesn't belong in
// this generic Batch component (see personal-rfcs/react-dag-viewer-rfc.md section 5 for the
// aggregation design this deliberately leaves out of a first version).
export function JobGraphView({ jobs, jobGraph, batchBaseUrl, batchId }: Props): JSX.Element {
  const jobNameById = useMemo(() => new Map((jobs ?? []).map((j) => [j.job_id, j.name])), [jobs]);
  const jobStateById = useMemo(() => new Map((jobs ?? []).map((j) => [j.job_id, j.state])), [jobs]);

  const nodes: DagNode[] = useMemo(
    () =>
      jobGraph.map((entry) => ({
        id: String(entry.job_id),
        label: jobLabel(entry.job_id, jobNameById),
        color: JOB_STATE_COLORS[jobStateById.get(entry.job_id) ?? 'Pending'],
      })),
    [jobGraph, jobNameById, jobStateById],
  );

  const edges: DagEdge[] = useMemo(
    () =>
      jobGraph.flatMap((entry) => entry.parent_ids.map((parentId) => ({ source: String(parentId), target: String(entry.job_id) }))),
    [jobGraph],
  );

  if (nodes.length === 0) {
    return <p className="text-sm text-zinc-400 italic">No jobs to graph.</p>;
  }

  if (nodes.length > MAX_RENDERABLE_NODES) {
    return (
      <p className="text-sm text-amber-700">
        This batch has {nodes.length} jobs — too many to render as a graph without freezing the page. Use the Job
        Groups or Job List tabs instead.
      </p>
    );
  }

  return (
    <div style={{ height: 600 }} className="border border-zinc-200 rounded">
      <DagGraph
        nodes={nodes}
        edges={edges}
        onNodeClick={(id) => window.open(`${batchBaseUrl}/batches/${batchId}/jobs/${id}`, '_blank')}
      />
    </div>
  );
}
