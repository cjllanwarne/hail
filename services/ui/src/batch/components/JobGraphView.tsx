import { useEffect, useMemo, useState } from 'react';
import { DagGraph } from '../../shared/DagGraph';
import type { DagNode, DagEdge } from '../../shared/DagGraph';
import { ROOT_JOB_GROUP_ID, JOB_STATE_PRIORITY } from './useBatchData';
import type { JobGraphEntry, JobGroupSummary, JobListEntry, JobState } from './useBatchData';

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
  // For labeling collapsed group nodes with their real name (attributes.name) instead of a bare
  // id — only covers groups directly under root, matching the one-level collapse below.
  getJobGroups: (parentJobGroupId: number) => JobGroupSummary[] | undefined;
  fetchJobGroups: (parentJobGroupId: number) => void;
}

// Beyond a few hundred nodes, rendering one DOM node per job (xyflow doesn't virtualize) gets
// sluggish/unresponsive regardless of how fast the layout computation itself is — and a job-level
// graph is already visually unreadable well before this point anyway (a CI build with heavy
// split/cleanup fan-out can have thousands of raw jobs). Refuse to render past this rather than
// silently freezing the tab; step-level aggregation (see the RFC referenced above) is the real
// fix for CI-scale builds, not a higher cap here.
const MAX_RENDERABLE_NODES = 500;

const GROUP_NODE_PREFIX = 'group-';

function jobLabel(job_id: number, jobNameById: Map<number, string | null>): string {
  return jobNameById.get(job_id) ?? `Job ${job_id}`;
}

// A job outside the root job group collapses into one node per job_group_id — jobs directly in
// the root group (the common case for a batch with no explicit job-group structure) stay as
// individual nodes. This only collapses by a job's *direct* group, not the full group hierarchy
// (nested sub-groups each get their own node) — building a true multi-level collapse would need
// the job-group tree fetched via fetchJobGroups, which isn't required just to cut clutter from the
// common one-level case.
function collapsedNodeId(job: JobListEntry | undefined, jobId: number): string {
  if (!job || job.job_group_id === ROOT_JOB_GROUP_ID) return String(jobId);
  return `${GROUP_NODE_PREFIX}${job.job_group_id}`;
}

function buildGraph(
  jobGraph: JobGraphEntry[],
  jobById: Map<number, JobListEntry>,
  jobNameById: Map<number, string | null>,
  jobStateById: Map<number, JobState>,
  groupNameById: Map<number, string | undefined>,
  collapseGroups: boolean,
): { nodes: DagNode[]; edges: DagEdge[] } {
  const nodeId = (jobId: number): string => (collapseGroups ? collapsedNodeId(jobById.get(jobId), jobId) : String(jobId));

  const groupMembers = new Map<string, number[]>();
  for (const entry of jobGraph) {
    const id = nodeId(entry.job_id);
    const members = groupMembers.get(id);
    if (members) members.push(entry.job_id);
    else groupMembers.set(id, [entry.job_id]);
  }

  const nodes: DagNode[] = [...groupMembers.entries()].map(([id, jobIds]) => {
    if (!id.startsWith(GROUP_NODE_PREFIX)) {
      const jobId = jobIds[0];
      return { id, label: jobLabel(jobId, jobNameById), color: JOB_STATE_COLORS[jobStateById.get(jobId) ?? 'Pending'] };
    }
    const states = jobIds.map((jobId) => jobStateById.get(jobId) ?? 'Pending');
    const worstState = JOB_STATE_PRIORITY.find((s) => states.includes(s)) ?? 'Pending';
    const groupId = id.slice(GROUP_NODE_PREFIX.length);
    const name = groupNameById.get(Number(groupId)) ?? `Job Group ${groupId}`;
    return { id, label: `${name} (${jobIds.length} jobs)`, color: JOB_STATE_COLORS[worstState], weight: jobIds.length };
  });

  const edgeKeys = new Set<string>();
  const edges: DagEdge[] = [];
  for (const entry of jobGraph) {
    const target = nodeId(entry.job_id);
    for (const parentId of entry.parent_ids) {
      const source = nodeId(parentId);
      if (source === target) continue; // dropped: parent and child collapsed into the same group
      const key = `${source}->${target}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ source, target });
    }
  }

  return { nodes, edges };
}

// Raw per-job dependency graph, optionally collapsed by job group — collapsing by *name/step*
// (CI's build.yaml step boundaries) is a CI-specific concern left out of this generic Batch
// component (see personal-rfcs/react-dag-viewer-rfc.md section 5); collapsing by job group is a
// generic Batch concept every host already has for free from useBatchData.
export function JobGraphView({ jobs, jobGraph, batchBaseUrl, batchId, getJobGroups, fetchJobGroups }: Props): JSX.Element {
  const jobById = useMemo(() => new Map((jobs ?? []).map((j) => [j.job_id, j])), [jobs]);
  const jobNameById = useMemo(() => new Map((jobs ?? []).map((j) => [j.job_id, j.name])), [jobs]);
  const jobStateById = useMemo(() => new Map((jobs ?? []).map((j) => [j.job_id, j.state])), [jobs]);
  const hasJobGroups = useMemo(() => (jobs ?? []).some((j) => j.job_group_id !== ROOT_JOB_GROUP_ID), [jobs]);

  useEffect(() => {
    fetchJobGroups(ROOT_JOB_GROUP_ID);
  }, [fetchJobGroups]);
  const rootGroups = getJobGroups(ROOT_JOB_GROUP_ID);
  const groupNameById = useMemo(
    () => new Map((rootGroups ?? []).map((g) => [g.job_group_id, g.attributes?.name])),
    [rootGroups],
  );

  const [collapseGroups, setCollapseGroups] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const { nodes, edges } = useMemo(
    () => buildGraph(jobGraph, jobById, jobNameById, jobStateById, groupNameById, collapseGroups && hasJobGroups),
    [jobGraph, jobById, jobNameById, jobStateById, groupNameById, collapseGroups, hasJobGroups],
  );

  if (nodes.length === 0) {
    return <p className="text-sm text-zinc-400 italic">No jobs to graph.</p>;
  }

  if (nodes.length > MAX_RENDERABLE_NODES) {
    return (
      <p className="text-sm text-amber-700">
        This batch has {nodes.length} {collapseGroups && hasJobGroups ? 'nodes' : 'jobs'} — too many to render as a
        graph without freezing the page. Use the Job Groups or Job List tabs instead.
      </p>
    );
  }

  const handleNodeClick = (id: string): void => {
    if (id.startsWith(GROUP_NODE_PREFIX)) return; // no single job page to open for a collapsed group
    window.open(`${batchBaseUrl}/batches/${batchId}/jobs/${id}`, '_blank');
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        {hasJobGroups ? (
          <label className="flex items-center gap-1.5 text-xs text-zinc-600">
            <input type="checkbox" checked={collapseGroups} onChange={(e) => setCollapseGroups(e.target.checked)} />
            Collapse job groups
          </label>
        ) : (
          <span />
        )}
        <button type="button" className="text-xs text-sky-600 hover:underline" onClick={() => setExpanded(true)}>
          Expand
        </button>
      </div>
      <div style={{ height: 600 }} className="border border-zinc-200 rounded">
        <DagGraph nodes={nodes} edges={edges} onNodeClick={handleNodeClick} />
      </div>

      {expanded && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded shadow-lg w-full h-full max-w-[95vw] p-4 flex flex-col">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-semibold text-zinc-600">Batch Graph</h3>
              <div className="flex items-center gap-4">
                {hasJobGroups && (
                  <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                    <input type="checkbox" checked={collapseGroups} onChange={(e) => setCollapseGroups(e.target.checked)} />
                    Collapse job groups
                  </label>
                )}
                <button type="button" className="text-xs text-sky-600 hover:underline" onClick={() => setExpanded(false)}>
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 border border-zinc-200 rounded">
              <DagGraph nodes={nodes} edges={edges} onNodeClick={handleNodeClick} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
