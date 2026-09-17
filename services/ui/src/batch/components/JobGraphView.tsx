import { useEffect, useMemo, useState } from 'react';
import { DagGraph } from '../../shared/DagGraph';
import type { DagNode, DagEdge } from '../../shared/DagGraph';
import { ROOT_JOB_GROUP_ID, JOB_STATE_PRIORITY } from './useBatchData';
import type { JobGraphEntry, JobGroupNode, JobListEntry, JobState } from './useBatchData';

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
  jobGroupTree: JobGroupNode[] | undefined;
  jobGroupTreeError: string | undefined;
  fetchJobGroupTree: () => void;
  batchBaseUrl: string;
  batchId: number;
  batchName: string | undefined;
}

// Beyond a few hundred nodes, rendering one DOM node per job (xyflow doesn't virtualize) gets
// sluggish/unresponsive regardless of how fast the layout computation itself is. Refuse to render
// past this rather than freezing the tab — drilling into a specific group (see below) is the way
// to get a big batch down under this.
const MAX_RENDERABLE_NODES = 500;

const GROUP_NODE_PREFIX = 'group-';
const JOB_NODE_PREFIX = 'job-';
// Sentinel selectedGroup value for "skip collapsing entirely, show every job" — distinct from any
// real job_group_id (which are non-negative).
const EXPANDED = -1;

function jobLabel(jobId: number, jobNameById: Map<number, string | null>): string {
  return jobNameById.get(jobId) ?? `Job ${jobId}`;
}

// Precomputed once per jobGroupTree fetch, not per render or per dropdown change.
interface GroupIndex {
  nameByGroupId: Map<number, string | undefined>;
  childrenByGroupId: Map<number, number[]>;
  // Root-to-self id chain for every group, e.g. group 5 (nested under 2, under root) -> [0, 2, 5].
  pathByGroupId: Map<number, number[]>;
}

function buildGroupIndex(tree: JobGroupNode[]): GroupIndex {
  const nameByGroupId = new Map<number, string | undefined>();
  const parentByGroupId = new Map<number, number>();
  const childrenByGroupId = new Map<number, number[]>();
  for (const g of tree) {
    nameByGroupId.set(g.job_group_id, g.attributes?.name);
    parentByGroupId.set(g.job_group_id, g.parent_job_group_id);
    const siblings = childrenByGroupId.get(g.parent_job_group_id);
    if (siblings) siblings.push(g.job_group_id);
    else childrenByGroupId.set(g.parent_job_group_id, [g.job_group_id]);
  }

  const pathByGroupId = new Map<number, number[]>([[ROOT_JOB_GROUP_ID, [ROOT_JOB_GROUP_ID]]]);
  function pathFor(groupId: number): number[] {
    const cached = pathByGroupId.get(groupId);
    if (cached) return cached;
    const parentId = parentByGroupId.get(groupId) ?? ROOT_JOB_GROUP_ID;
    const path = [...pathFor(parentId), groupId];
    pathByGroupId.set(groupId, path);
    return path;
  }
  for (const g of tree) pathFor(g.job_group_id);

  return { nameByGroupId, childrenByGroupId, pathByGroupId };
}

// The node representing a job when viewing `selectedGroup`: the job itself if it's directly in
// that group, the direct child group leading down to it otherwise, or undefined if the job isn't
// under selectedGroup at all.
function viewNodeForJob(job: JobListEntry | undefined, jobId: number, selectedGroup: number, groupIndex: GroupIndex): string | undefined {
  if (selectedGroup === EXPANDED) return `${JOB_NODE_PREFIX}${jobId}`;
  const directGroup = job?.job_group_id ?? ROOT_JOB_GROUP_ID;
  const path = groupIndex.pathByGroupId.get(directGroup) ?? [ROOT_JOB_GROUP_ID];
  const idx = path.indexOf(selectedGroup);
  if (idx === -1) return undefined;
  if (idx === path.length - 1) return `${JOB_NODE_PREFIX}${jobId}`;
  return `${GROUP_NODE_PREFIX}${path[idx + 1]}`;
}

function buildGraph(
  jobGraph: JobGraphEntry[],
  jobById: Map<number, JobListEntry>,
  jobNameById: Map<number, string | null>,
  jobStateById: Map<number, JobState>,
  groupIndex: GroupIndex,
  selectedGroup: number,
): { nodes: DagNode[]; edges: DagEdge[] } {
  const nodeId = (jobId: number): string | undefined => viewNodeForJob(jobById.get(jobId), jobId, selectedGroup, groupIndex);

  const groupMembers = new Map<string, number[]>();
  for (const entry of jobGraph) {
    const id = nodeId(entry.job_id);
    if (id === undefined) continue;
    const members = groupMembers.get(id);
    if (members) members.push(entry.job_id);
    else groupMembers.set(id, [entry.job_id]);
  }

  const nodes: DagNode[] = [...groupMembers.entries()].map(([id, jobIds]) => {
    if (id.startsWith(JOB_NODE_PREFIX)) {
      const jobId = jobIds[0];
      return { id, label: jobLabel(jobId, jobNameById), color: JOB_STATE_COLORS[jobStateById.get(jobId) ?? 'Pending'] };
    }
    const states = jobIds.map((jobId) => jobStateById.get(jobId) ?? 'Pending');
    const worstState = JOB_STATE_PRIORITY.find((s) => states.includes(s)) ?? 'Pending';
    const groupId = Number(id.slice(GROUP_NODE_PREFIX.length));
    const name = groupIndex.nameByGroupId.get(groupId) ?? `Job Group ${groupId}`;
    return { id, label: `${name} (${jobIds.length} jobs)`, color: JOB_STATE_COLORS[worstState], weight: jobIds.length };
  });

  const edgeKeys = new Set<string>();
  const edges: DagEdge[] = [];
  for (const entry of jobGraph) {
    const target = nodeId(entry.job_id);
    if (target === undefined) continue;
    for (const parentId of entry.parent_ids) {
      const source = nodeId(parentId);
      if (source === undefined || source === target) continue;
      const key = `${source}->${target}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ source, target });
    }
  }

  return { nodes, edges };
}

interface GroupOption {
  id: number;
  label: string;
}

function buildGroupOptions(groupIndex: GroupIndex, batchLabel: string): GroupOption[] {
  const options: GroupOption[] = [{ id: ROOT_JOB_GROUP_ID, label: batchLabel }];
  function walk(parentId: number, depth: number): void {
    for (const childId of groupIndex.childrenByGroupId.get(parentId) ?? []) {
      const name = groupIndex.nameByGroupId.get(childId) ?? `Job Group ${childId}`;
      options.push({ id: childId, label: `${'  '.repeat(depth)}${name} (${childId})` });
      walk(childId, depth + 1);
    }
  }
  walk(ROOT_JOB_GROUP_ID, 1);
  options.push({ id: EXPANDED, label: 'All jobs, expanded' });
  return options;
}

// Shows the direct descendants (jobs or sub-groups) of a chosen job group — click a sub-group node
// to drill into it, or jump anywhere via the dropdown. Collapsing by job group is a generic Batch
// concept every host gets for free from useBatchData; collapsing by CI's build.yaml step names
// instead is a CI-specific concern left for a future CI-specific consumer of DagGraph.
export function JobGraphView({ jobs, jobGraph, jobGroupTree, jobGroupTreeError, fetchJobGroupTree, batchBaseUrl, batchId, batchName }: Props): JSX.Element {
  const jobById = useMemo(() => new Map((jobs ?? []).map((j) => [j.job_id, j])), [jobs]);
  const jobNameById = useMemo(() => new Map((jobs ?? []).map((j) => [j.job_id, j.name])), [jobs]);
  const jobStateById = useMemo(() => new Map((jobs ?? []).map((j) => [j.job_id, j.state])), [jobs]);

  useEffect(() => {
    fetchJobGroupTree();
  }, [fetchJobGroupTree]);

  const [selectedGroup, setSelectedGroup] = useState(ROOT_JOB_GROUP_ID);
  const [expanded, setExpanded] = useState(false);

  const groupIndex = useMemo(() => buildGroupIndex(jobGroupTree ?? []), [jobGroupTree]);
  const batchLabel = batchName ?? `Batch ${batchId}`;
  const groupOptions = useMemo(() => buildGroupOptions(groupIndex, batchLabel), [groupIndex, batchLabel]);
  const { nodes, edges } = useMemo(
    () => buildGraph(jobGraph, jobById, jobNameById, jobStateById, groupIndex, selectedGroup),
    [jobGraph, jobById, jobNameById, jobStateById, groupIndex, selectedGroup],
  );

  if (jobGroupTreeError) {
    return <p className="text-sm text-red-600">{jobGroupTreeError}</p>;
  }
  if (jobGroupTree === undefined) {
    return <p className="text-sm text-zinc-500">Loading job groups&hellip;</p>;
  }
  if (nodes.length === 0) {
    return <p className="text-sm text-zinc-400 italic">No jobs in this group.</p>;
  }
  if (nodes.length > MAX_RENDERABLE_NODES) {
    return (
      <p className="text-sm text-amber-700">
        This group has {nodes.length} direct descendants — too many to render as a graph without freezing the page.
        Pick a more specific group above.
      </p>
    );
  }

  const handleNodeClick = (id: string): void => {
    if (id.startsWith(GROUP_NODE_PREFIX)) {
      setSelectedGroup(Number(id.slice(GROUP_NODE_PREFIX.length)));
      return;
    }
    window.open(`${batchBaseUrl}/batches/${batchId}/jobs/${id.slice(JOB_NODE_PREFIX.length)}`, '_blank');
  };

  const groupSelect = groupOptions.length > 1 && (
    <select
      className="text-xs border border-zinc-300 rounded px-1 py-0.5"
      value={selectedGroup}
      onChange={(e) => setSelectedGroup(Number(e.target.value))}
    >
      {groupOptions.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
        </option>
      ))}
    </select>
  );

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        {groupSelect || <span />}
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
                {groupSelect}
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
