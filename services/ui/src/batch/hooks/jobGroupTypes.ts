// Shared between any page that renders a job list or job-group tree (currently the CI PR page
// and the batch details page) — not specific to either fetching strategy.

export type JobState = 'Pending' | 'Ready' | 'Creating' | 'Running' | 'Failed' | 'Cancelled' | 'Error' | 'Success';

export interface JobListEntry {
  job_id: number;
  job_group_id: number;
  name: string | null;
  state: JobState;
  exit_code: number | null;
}
