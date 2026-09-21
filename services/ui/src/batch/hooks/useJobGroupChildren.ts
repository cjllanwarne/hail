import { useCallback, useRef, useState } from 'react';
import { hailApiFetch as apiFetch } from '../../shared/hailApiFetch';
import type { BatchStatus, JobListEntry } from './usePrBatchData';

// Mirrors job_group_record_to_dict (batch/batch/batch.py), not the openapi.yaml
// JobGroupDetailResponse schema, which documents fields (`children`, `parent_job_group_id`)
// the real handler never sets.
export interface JobGroupSummary {
  job_group_id: number;
  n_jobs: number;
  n_completed: number;
  n_succeeded: number;
  n_failed: number;
  n_cancelled: number;
  attributes?: Record<string, string>;
}

// A batch always has an implicit root job group (id 0); every job lands there unless the
// submitter explicitly nests it in a sub-group via the hailtop.batch job-group API.
export const ROOT_JOB_GROUP_ID = 0;

// The root job group's counts are the batch's own aggregate counts — no fetch needed.
export function deriveRootJobGroup(batchStatus: BatchStatus | null): JobGroupSummary | null {
  return batchStatus
    ? {
        job_group_id: ROOT_JOB_GROUP_ID,
        n_jobs: batchStatus.n_jobs,
        n_completed: batchStatus.n_completed,
        n_succeeded: batchStatus.n_succeeded,
        n_failed: batchStatus.n_failed,
        n_cancelled: batchStatus.n_cancelled,
        attributes: batchStatus.attributes,
      }
    : null;
}

// Jobs directly in a group are just a job's own job_group_id — a synchronous filter over an
// already-fetched job list, never a fetch.
export function getJobsInGroup(jobs: JobListEntry[] | null, parentJobGroupId: number): JobListEntry[] {
  return (jobs ?? []).filter((j) => j.job_group_id === parentJobGroupId);
}

async function fetchJobGroups(batchBaseUrl: string, batchId: number, parentJobGroupId: number): Promise<JobGroupSummary[]> {
  const all: JobGroupSummary[] = [];
  let lastId: number | undefined;
  for (;;) {
    const url = new URL(`${batchBaseUrl}/api/v1alpha/batches/${batchId}/job-groups/${parentJobGroupId}/job-groups`, window.location.origin);
    if (lastId !== undefined) url.searchParams.set('last_job_group_id', String(lastId));
    const page = await apiFetch<{ job_groups: JobGroupSummary[]; last_job_group_id?: number }>(url.toString());
    all.push(...page.job_groups);
    if (page.last_job_group_id === undefined) break;
    lastId = page.last_job_group_id;
  }
  return all;
}

export interface UseJobGroupChildrenResult {
  // undefined until fetchJobGroups(parentJobGroupId) has resolved at least once.
  getJobGroups: (parentJobGroupId: number) => JobGroupSummary[] | undefined;
  getJobGroupsError: (parentJobGroupId: number) => string | undefined;
  // Fetches and caches a job group's children, keyed by parentJobGroupId. Idempotent: a no-op
  // while in flight or after success; a failed fetch isn't cached, so a later call retries.
  fetchJobGroups: (parentJobGroupId: number) => void;
}

// This is the only part of "job groups" that's a real fetch: a group's own child groups (and
// their rollup counts) aren't derivable from the job list, unlike deriveRootJobGroup/
// getJobsInGroup above.
export function useJobGroupChildren(batchBaseUrl: string, batchId: number | undefined): UseJobGroupChildrenResult {
  const [jobGroupsByParent, setJobGroupsByParent] = useState<Map<number, JobGroupSummary[]>>(new Map());
  const [jobGroupErrorsByParent, setJobGroupErrorsByParent] = useState<Map<number, string>>(new Map());
  // Ref, not state: bookkeeping for fetchJobGroups's idempotency check, not render input.
  const jobGroupFetchesStarted = useRef<Set<number>>(new Set());

  const fetchJobGroupsFor = useCallback((parentJobGroupId: number) => {
    if (batchId === undefined) return;
    if (jobGroupFetchesStarted.current.has(parentJobGroupId)) return;
    jobGroupFetchesStarted.current.add(parentJobGroupId);
    fetchJobGroups(batchBaseUrl, batchId, parentJobGroupId)
      .then((groups) => {
        setJobGroupsByParent((prev) => new Map(prev).set(parentJobGroupId, groups));
      })
      .catch((e: unknown) => {
        jobGroupFetchesStarted.current.delete(parentJobGroupId); // allow a retry
        setJobGroupErrorsByParent((prev) => new Map(prev).set(parentJobGroupId, e instanceof Error ? e.message : String(e)));
      });
  }, [batchBaseUrl, batchId]);

  const getJobGroups = useCallback(
    (parentJobGroupId: number): JobGroupSummary[] | undefined => jobGroupsByParent.get(parentJobGroupId),
    [jobGroupsByParent],
  );

  const getJobGroupsError = useCallback(
    (parentJobGroupId: number): string | undefined => jobGroupErrorsByParent.get(parentJobGroupId),
    [jobGroupErrorsByParent],
  );

  return { getJobGroups, getJobGroupsError, fetchJobGroups: fetchJobGroupsFor };
}
