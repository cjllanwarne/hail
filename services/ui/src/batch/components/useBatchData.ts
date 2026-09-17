import { useCallback, useRef, useState } from 'react';
import { hailApiFetch as apiFetch } from '../../shared/hailApiFetch';

// Generic Batch-domain data for a single batch: its own status, its full (recursive) job list,
// and its job-group hierarchy. Deliberately has no CI-specific (or any other service-specific)
// knowledge — any page showing a batch's jobs/job-groups (the CI PR page today, a future React
// batch-details page tomorrow) should use this instead of writing its own fetch/cache logic.
// See dev-docs/services/ui/README.md's "Data fetching for a batch" section for the pattern this
// is meant to establish.

export type JobState = 'Pending' | 'Ready' | 'Creating' | 'Running' | 'Failed' | 'Cancelled' | 'Error' | 'Success';

export interface JobListEntry {
  job_id: number;
  job_group_id: number;
  name: string | null;
  state: JobState;
  exit_code: number | null;
}

// Mirrors job_group_record_to_dict (batch/batch/batch.py) — this is what
// GET .../job-groups/{id} and GET .../job-groups/{id}/job-groups actually return. Note this does
// NOT match the openapi.yaml JobGroupDetailResponse schema, which documents a `children` field
// and a `parent_job_group_id` field that the real handler never sets — that schema is
// aspirational/stale, not a contract the backend honors today.
export interface JobGroupSummary {
  job_group_id: number;
  n_jobs: number;
  n_completed: number;
  n_succeeded: number;
  n_failed: number;
  n_cancelled: number;
  attributes?: Record<string, string>;
}

// Flattened, one row per attempt of every job in the batch — built client-side from the real
// paginated GetBatchTimingResponseV1Alpha (hailtop/batch_client/types.py), which nests attempts
// under each job and carries no job state. `state` here is joined in from the already-fetched
// job list. A job that hasn't started yet has a null attempt_id/start_time/end_time.
export interface JobTimingEntry {
  job_id: number;
  attempt_id: string | null;
  start_time: number | null;
  end_time: number | null;
  reason: string | null;
  state: JobState;
}

interface JobOffsetPagination {
  current_job_offset: number;
  next_page_job_offset: number | null;
  page_size: number;
  total_jobs: number;
}

interface AttemptTiming {
  attempt_id: string;
  start_time: number | null;
  end_time: number | null;
  reason: string | null;
}

interface JobTiming {
  job_id: number;
  attempts: AttemptTiming[];
}

interface GetBatchTimingResponse {
  data: JobTiming[];
  pagination: JobOffsetPagination;
}

// Mirrors JobGraphEntryV1Alpha (hailtop/batch_client/types.py) — one entry per job, with the ids
// of its direct parents (empty for a job with no parents). Job metadata (name, state) is not
// included here by design; join client-side against the already-fetched job list by job_id.
export interface JobGraphEntry {
  job_id: number;
  parent_ids: number[];
}

interface GetJobGraphResponse {
  data: JobGraphEntry[];
  pagination: JobOffsetPagination;
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

// A batch always has an implicit root job group (id 0); every job lands there unless the
// submitter explicitly nests it in a sub-group via the hailtop.batch job-group API.
export const ROOT_JOB_GROUP_ID = 0;

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

async function fetchAllTiming(batchBaseUrl: string, batchId: number): Promise<JobTiming[]> {
  const all: JobTiming[] = [];
  let jobOffset: number | undefined;
  for (;;) {
    const url = new URL(`${batchBaseUrl}/api/v1alpha/batches/${batchId}/timing`, window.location.origin);
    if (jobOffset !== undefined) url.searchParams.set('job_offset', String(jobOffset));
    const page = await apiFetch<GetBatchTimingResponse>(url.toString());
    all.push(...page.data);
    if (page.pagination.next_page_job_offset === null) break;
    jobOffset = page.pagination.next_page_job_offset;
  }
  return all;
}

async function fetchAllJobGraph(batchBaseUrl: string, batchId: number): Promise<JobGraphEntry[]> {
  const all: JobGraphEntry[] = [];
  let jobOffset: number | undefined;
  for (;;) {
    const url = new URL(`${batchBaseUrl}/api/v1alpha/batches/${batchId}/job_graph`, window.location.origin);
    if (jobOffset !== undefined) url.searchParams.set('job_offset', String(jobOffset));
    // page_size defaults to 50 server-side (matches /timing's DEFAULT_JOB_OFFSET_PAGE_SIZE) — set
    // it to the server's max (1000) explicitly so fetching a whole batch's graph doesn't take
    // dozens of round trips for CI's largest builds (~thousands of jobs).
    url.searchParams.set('page_size', '1000');
    const page = await apiFetch<GetJobGraphResponse>(url.toString());
    all.push(...page.data);
    if (page.pagination.next_page_job_offset === null) break;
    jobOffset = page.pagination.next_page_job_offset;
  }
  return all;
}

export interface UseBatchDataResult {
  batchStatus: BatchStatus | null;
  jobs: JobListEntry[] | null;
  jobsError: string | null;
  refreshing: boolean;
  // Re-fetches batchStatus + the full job list. Call once on mount and on whatever interval/
  // toggle drives the page's auto-refresh UI — this hook has no polling opinion of its own,
  // since when/whether to poll is page-level UI policy, not a data-fetching concern.
  refresh: (isRefresh: boolean) => Promise<void>;
  // The root job group's rollup counts are the batch's own aggregate counts (root job group IS
  // the batch, not a separate fetched entity) — derived from batchStatus, no extra request.
  rootJobGroup: JobGroupSummary | null;
  // Jobs directly owned by a given job group — synchronous, filtered from the already-fetched
  // recursive job list. Never triggers a request.
  getJobs: (parentJobGroupId: number) => JobListEntry[];
  // Sub-job-groups of a given job group. Returns undefined until fetchJobGroups(parentJobGroupId)
  // has been called and resolved at least once.
  getJobGroups: (parentJobGroupId: number) => JobGroupSummary[] | undefined;
  getJobGroupsError: (parentJobGroupId: number) => string | undefined;
  // Fetches (once) and caches a job group's children, keyed by parentJobGroupId, for the
  // lifetime of this hook instance — i.e. for as long as the page stays mounted. Safe to call
  // repeatedly (e.g. on every row expand): a second call while a fetch is in flight or after one
  // has already succeeded is a no-op. A failed fetch is not cached, so a later call retries.
  fetchJobGroups: (parentJobGroupId: number) => void;
  // Per-attempt start/end timing for every job in the batch, for a timing overview chart. Whole
  // batch only for now (not scoped to a job group) — undefined until fetchTiming() has been
  // called and resolved at least once.
  timing: JobTimingEntry[] | undefined;
  timingError: string | undefined;
  // Fetches (once) and caches batch-wide timing data, for as long as this hook instance stays
  // mounted. Safe to call repeatedly: a no-op while in flight or after success. A failed fetch is
  // not cached, so a later call retries.
  fetchTiming: () => void;
  // Parent-id edges for every job in the batch, for a dependency-DAG viewer. Whole batch only for
  // now (not scoped to a job group) — undefined until fetchJobGraph() has been called and
  // resolved at least once.
  jobGraph: JobGraphEntry[] | undefined;
  jobGraphError: string | undefined;
  // Fetches (once) and caches the batch-wide job graph, for as long as this hook instance stays
  // mounted. Safe to call repeatedly: a no-op while in flight or after success. A failed fetch is
  // not cached, so a later call retries.
  fetchJobGraph: () => void;
}

export function useBatchData(batchBaseUrl: string, batchId: number | undefined): UseBatchDataResult {
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const [jobs, setJobs] = useState<JobListEntry[] | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [jobGroupsByParent, setJobGroupsByParent] = useState<Map<number, JobGroupSummary[]>>(new Map());
  const [jobGroupErrorsByParent, setJobGroupErrorsByParent] = useState<Map<number, string>>(new Map());
  // Tracks in-flight/succeeded fetches so fetchJobGroups is idempotent without waiting for a
  // state update to land — a ref (not state) because it's bookkeeping, not something that
  // should itself trigger a re-render.
  const jobGroupFetchesStarted = useRef<Set<number>>(new Set());

  const [timing, setTiming] = useState<JobTimingEntry[] | undefined>(undefined);
  const [timingError, setTimingError] = useState<string | undefined>(undefined);
  const timingFetchStarted = useRef(false);

  const [jobGraph, setJobGraph] = useState<JobGraphEntry[] | undefined>(undefined);
  const [jobGraphError, setJobGraphError] = useState<string | undefined>(undefined);
  const jobGraphFetchStarted = useRef(false);

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

  const fetchTiming = useCallback(() => {
    if (batchId === undefined) return;
    if (timingFetchStarted.current) return;
    timingFetchStarted.current = true;
    fetchAllTiming(batchBaseUrl, batchId)
      .then((jobTimings) => {
        // Timing responses don't carry job state (see GetBatchTimingResponseV1Alpha) — join it
        // in from the already-fetched job list instead.
        const stateByJobId = new Map((jobs ?? []).map((j) => [j.job_id, j.state]));
        const entries: JobTimingEntry[] = jobTimings.flatMap((job): JobTimingEntry[] => {
          const state = stateByJobId.get(job.job_id) ?? 'Pending';
          if (job.attempts.length === 0) {
            return [{ job_id: job.job_id, attempt_id: null, start_time: null, end_time: null, reason: null, state }];
          }
          return job.attempts.map((a) => ({
            job_id: job.job_id,
            attempt_id: a.attempt_id,
            start_time: a.start_time,
            end_time: a.end_time,
            reason: a.reason,
            state,
          }));
        });
        setTiming(entries);
      })
      .catch((e: unknown) => {
        timingFetchStarted.current = false; // allow a retry
        setTimingError(e instanceof Error ? e.message : String(e));
      });
  }, [batchBaseUrl, batchId, jobs]);

  const fetchJobGraph = useCallback(() => {
    if (batchId === undefined) return;
    if (jobGraphFetchStarted.current) return;
    jobGraphFetchStarted.current = true;
    fetchAllJobGraph(batchBaseUrl, batchId)
      .then((entries) => {
        setJobGraph(entries);
      })
      .catch((e: unknown) => {
        jobGraphFetchStarted.current = false; // allow a retry
        setJobGraphError(e instanceof Error ? e.message : String(e));
      });
  }, [batchBaseUrl, batchId]);

  const getJobs = useCallback(
    (parentJobGroupId: number): JobListEntry[] => (jobs ?? []).filter((j) => j.job_group_id === parentJobGroupId),
    [jobs],
  );

  const getJobGroups = useCallback(
    (parentJobGroupId: number): JobGroupSummary[] | undefined => jobGroupsByParent.get(parentJobGroupId),
    [jobGroupsByParent],
  );

  const getJobGroupsError = useCallback(
    (parentJobGroupId: number): string | undefined => jobGroupErrorsByParent.get(parentJobGroupId),
    [jobGroupErrorsByParent],
  );

  const rootJobGroup: JobGroupSummary | null = batchStatus
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

  return {
    batchStatus,
    jobs,
    jobsError,
    refreshing,
    refresh,
    rootJobGroup,
    getJobs,
    getJobGroups,
    getJobGroupsError,
    fetchJobGroups: fetchJobGroupsFor,
    timing,
    timingError,
    fetchTiming,
    jobGraph,
    jobGraphError,
    fetchJobGraph,
  };
}
