import { useCallback, useState } from 'react';
import { hailApiFetch as apiFetch } from '../../shared/hailApiFetch';

// Fetches a batch's status and its full (recursive) job list in one shot, no pagination.
// Only fits pages where a batch's job count is bounded (e.g. CI's own build batches) — a batch
// details page showing arbitrary user batches needs server-side pagination instead.

export type JobState = 'Pending' | 'Ready' | 'Creating' | 'Running' | 'Failed' | 'Cancelled' | 'Error' | 'Success';

export interface JobListEntry {
  job_id: number;
  job_group_id: number;
  name: string | null;
  state: JobState;
  exit_code: number | null;
}

export interface BatchStatus {
  id: number;
  state: string;
  complete: boolean;
  cost: number | null;
  n_jobs: number;
  n_completed: number;
  n_succeeded: number;
  n_failed: number;
  n_cancelled: number;
  time_created: string | null;
  time_completed: string | null;
  attributes?: Record<string, string>;
}

async function fetchAllJobs(batchBaseUrl: string, batchId: number): Promise<JobListEntry[]> {
  const all: JobListEntry[] = [];
  let lastId: number | undefined;
  for (;;) {
    const url = new URL(`${batchBaseUrl}/api/v1alpha/batches/${batchId}/jobs`, window.location.origin);
    if (lastId !== undefined) url.searchParams.set('last_job_id', String(lastId));
    const page = await apiFetch<{ jobs: JobListEntry[]; last_job_id?: number }>(url.toString());
    all.push(...page.jobs);
    if (page.last_job_id === undefined) break;
    lastId = page.last_job_id;
  }
  return all;
}

export interface UsePrBatchDataResult {
  batchStatus: BatchStatus | null;
  jobs: JobListEntry[] | null;
  jobsError: string | null;
  refreshing: boolean;
  // Re-fetches batchStatus + the full job list; caller decides when/how often to call this.
  refresh: (isRefresh: boolean) => Promise<void>;
}

export function usePrBatchData(batchBaseUrl: string, batchId: number | undefined): UsePrBatchDataResult {
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const [jobs, setJobs] = useState<JobListEntry[] | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (isRefresh: boolean) => {
    if (batchId === undefined) return;
    if (isRefresh) setRefreshing(true);
    try {
      const [status, allJobs] = await Promise.all([
        apiFetch<BatchStatus>(`${batchBaseUrl}/api/v1alpha/batches/${batchId}`),
        fetchAllJobs(batchBaseUrl, batchId),
      ]);
      setBatchStatus(status);
      setJobs(allJobs);
      setJobsError(null);
    } catch (e: unknown) {
      setJobsError(e instanceof Error ? e.message : String(e));
    } finally {
      if (isRefresh) setRefreshing(false);
    }
  }, [batchBaseUrl, batchId]);

  return { batchStatus, jobs, jobsError, refreshing, refresh };
}
