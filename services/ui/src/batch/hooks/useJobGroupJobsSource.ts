import { useCallback, useRef, useState } from 'react';
import { hailApiFetch as apiFetch } from '../../shared/hailApiFetch';
import { getJobsInGroup } from './useJobGroupChildren';
import type { JobListEntry } from './jobGroupTypes';

// Abstracts over how a JobGroupTree gets the jobs that sit directly in a given group — a page
// that already has the whole batch's job list in memory can filter it for free (see
// useStaticJobGroupJobs), while a page that only ever holds one paginated/searched slice of jobs
// (e.g. the batch details page) has to fetch each group's jobs directly (see
// useLazyJobGroupJobs). JobGroupTree itself doesn't know or care which is behind the interface.
export interface JobGroupJobsSource {
  // undefined = not loaded yet.
  getJobs: (jobGroupId: number) => JobListEntry[] | undefined;
  getJobsError: (jobGroupId: number) => string | undefined;
  getJobsTruncated: (jobGroupId: number) => boolean;
  // No-op for the static source (the jobs are already loaded, or loading, as a whole); triggers
  // and caches a fetch for the lazy source. Idempotent either way.
  ensureLoaded: (jobGroupId: number) => void;
}

export function useStaticJobGroupJobs(jobs: JobListEntry[] | null): JobGroupJobsSource {
  const getJobs = useCallback(
    (jobGroupId: number): JobListEntry[] | undefined => (jobs === null ? undefined : getJobsInGroup(jobs, jobGroupId)),
    [jobs],
  );
  const getJobsError = useCallback(() => undefined, []);
  const getJobsTruncated = useCallback(() => false, []);
  const ensureLoaded = useCallback(() => { /* the full list is already loaded (or loading) */ }, []);
  return { getJobs, getJobsError, getJobsTruncated, ensureLoaded };
}

const JOB_GROUP_JOBS_DISPLAY_LIMIT = 50;

async function fetchJobsInGroup(
  batchBaseUrl: string, batchId: number, jobGroupId: number,
): Promise<{ jobs: JobListEntry[]; truncated: boolean }> {
  const page = await apiFetch<{ jobs: JobListEntry[]; last_job_id?: number }>(
    `${batchBaseUrl}/api/v1alpha/batches/${batchId}/job-groups/${jobGroupId}/jobs`
  );
  return {
    jobs: page.jobs.slice(0, JOB_GROUP_JOBS_DISPLAY_LIMIT),
    truncated: page.jobs.length > JOB_GROUP_JOBS_DISPLAY_LIMIT || page.last_job_id !== undefined,
  };
}

// For pages (e.g. the batch details page) that can't derive group membership from an
// already-loaded job list. Each group's jobs are fetched only once expanded, and capped at
// JOB_GROUP_JOBS_DISPLAY_LIMIT — this is a peek at a group's direct jobs, not a substitute for
// the main jobs table with its own search/pagination.
export function useLazyJobGroupJobs(batchBaseUrl: string, batchId: number | undefined): JobGroupJobsSource {
  const [jobsByGroup, setJobsByGroup] = useState<Map<number, JobListEntry[]>>(new Map());
  const [truncatedGroups, setTruncatedGroups] = useState<Set<number>>(new Set());
  const [errorsByGroup, setErrorsByGroup] = useState<Map<number, string>>(new Map());
  const started = useRef<Set<number>>(new Set());

  const ensureLoaded = useCallback((jobGroupId: number) => {
    if (batchId === undefined) return;
    if (started.current.has(jobGroupId)) return;
    started.current.add(jobGroupId);
    fetchJobsInGroup(batchBaseUrl, batchId, jobGroupId)
      .then(({ jobs, truncated }) => {
        setJobsByGroup((prev) => new Map(prev).set(jobGroupId, jobs));
        if (truncated) setTruncatedGroups((prev) => new Set(prev).add(jobGroupId));
      })
      .catch((e: unknown) => {
        started.current.delete(jobGroupId); // allow a retry
        setErrorsByGroup((prev) => new Map(prev).set(jobGroupId, e instanceof Error ? e.message : String(e)));
      });
  }, [batchBaseUrl, batchId]);

  const getJobs = useCallback((jobGroupId: number) => jobsByGroup.get(jobGroupId), [jobsByGroup]);
  const getJobsError = useCallback((jobGroupId: number) => errorsByGroup.get(jobGroupId), [errorsByGroup]);
  const getJobsTruncated = useCallback((jobGroupId: number) => truncatedGroups.has(jobGroupId), [truncatedGroups]);

  return { getJobs, getJobsError, getJobsTruncated, ensureLoaded };
}
