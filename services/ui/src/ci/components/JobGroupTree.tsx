import { SegmentedBar } from '../../shared/SegmentedBar';
import type { Segment } from '../../shared/SegmentedBar';
import { CollapsibleItem } from '../../batch/components/CollapsibleItem';
import { ROOT_JOB_GROUP_ID, getJobsInGroup } from '../../batch/hooks/useJobGroupChildren';
import type { JobGroupSummary, UseJobGroupChildrenResult } from '../../batch/hooks/useJobGroupChildren';
import type { JobListEntry } from '../../batch/hooks/usePrBatchData';
import { JobList } from './JobList';

export { ROOT_JOB_GROUP_ID };
export type { JobGroupSummary };

function jobGroupSegments(g: JobGroupSummary): Segment[] {
  const inProgress = g.n_jobs - g.n_completed;
  return [
    [g.n_succeeded, 'bg-green-500', `Succeeded: ${g.n_succeeded}`],
    [inProgress, 'bg-sky-400', `In progress: ${inProgress}`],
    [g.n_failed, 'bg-red-500', `Failed: ${g.n_failed}`],
    [g.n_cancelled, 'bg-zinc-400', `Cancelled: ${g.n_cancelled}`],
  ];
}

function groupLabel(g: JobGroupSummary): string {
  return g.attributes?.name ?? (g.job_group_id === ROOT_JOB_GROUP_ID ? 'root' : `job group ${g.job_group_id}`);
}

function JobGroupRow({ batchBaseUrl, batchId, summary, jobs, jobGroupChildren }: {
  batchBaseUrl: string;
  batchId: number;
  summary: JobGroupSummary;
  jobs: JobListEntry[] | null;
  jobGroupChildren: UseJobGroupChildrenResult;
}): JSX.Element {
  const childGroups = jobGroupChildren.getJobGroups(summary.job_group_id);
  const error = jobGroupChildren.getJobGroupsError(summary.job_group_id);
  // Doesn't wait on childGroups resolving — getJobsInGroup is a synchronous filter, not a fetch.
  const ownJobs = getJobsInGroup(jobs, summary.job_group_id);

  return (
    <CollapsibleItem
      title={groupLabel(summary)}
      summary={
        <div className="flex items-center gap-2">
          <SegmentedBar segments={jobGroupSegments(summary)} total={summary.n_jobs} className="h-3 w-32" />
          <span>{summary.n_completed}/{summary.n_jobs} jobs</span>
        </div>
      }
      onExpand={() => { jobGroupChildren.fetchJobGroups(summary.job_group_id); }}
    >
      <div className="pl-4">
        {error ? (
          <p className="text-xs text-red-600">{error}</p>
        ) : childGroups === undefined ? (
          <p className="text-xs text-zinc-400">Checking for sub-groups&hellip;</p>
        ) : childGroups.length > 0 ? (
          <ul className="border-l border-zinc-200">
            {childGroups.map((child) => (
              <JobGroupRow key={child.job_group_id} batchBaseUrl={batchBaseUrl} batchId={batchId} summary={child} jobs={jobs} jobGroupChildren={jobGroupChildren} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-zinc-400 mb-1">No sub-groups</p>
        )}

        {ownJobs.length > 0 && (
          <div className="mt-2">
            <p className="text-xs text-zinc-400 mb-1">Jobs directly in this group</p>
            <JobList jobs={ownJobs} batchBaseUrl={batchBaseUrl} batchId={batchId} />
          </div>
        )}
      </div>
    </CollapsibleItem>
  );
}

// Generic job-group hierarchy viewer, not CI-specific; child-group fetching/caching lives in
// useJobGroupChildren, everything else is derived from the already-fetched job list.
export function JobGroupTree({ batchBaseUrl, batchId, jobs, rootJobGroup, jobGroupChildren }: {
  batchBaseUrl: string;
  batchId: number;
  jobs: JobListEntry[] | null;
  rootJobGroup: JobGroupSummary | null;
  jobGroupChildren: UseJobGroupChildrenResult;
}): JSX.Element | null {
  if (!rootJobGroup) return null;
  return (
    <ul className="border border-zinc-200 rounded divide-y divide-zinc-100">
      <JobGroupRow batchBaseUrl={batchBaseUrl} batchId={batchId} summary={rootJobGroup} jobs={jobs} jobGroupChildren={jobGroupChildren} />
    </ul>
  );
}
