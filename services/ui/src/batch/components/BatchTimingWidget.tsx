import { useEffect, useState } from 'react';
import { useBatchData } from './useBatchData';
import { JobTimingChart } from './JobTimingChart';

interface Props { basePath: string; batchId: number }

// Standalone "Show timing" widget for the classic (Jinja2) batch-details page — mounts its own
// useBatchData instance rather than being fed one, since the classic page doesn't have a React
// data layer for it to plug into.
export function BatchTimingWidget({ basePath, batchId }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const { refresh, fetchTiming, jobs, timing, timingError } = useBatchData(basePath, batchId);

  useEffect(() => {
    refresh(false);
  }, [refresh]);

  if (!open) {
    return (
      <button
        type="button"
        className="text-sm text-sky-600 hover:underline"
        onClick={() => { setOpen(true); fetchTiming(); }}
      >
        Show timing
      </button>
    );
  }

  return (
    <div className="mt-2 border rounded p-3">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm font-semibold text-zinc-600">Job Timing</h3>
        <button type="button" className="text-xs text-sky-600 hover:underline" onClick={() => setOpen(false)}>
          Hide
        </button>
      </div>
      {timingError ? (
        <p className="text-sm text-red-600">{timingError}</p>
      ) : timing === undefined ? (
        <p className="text-sm text-zinc-500">Loading timing&hellip;</p>
      ) : (
        <JobTimingChart timing={timing} jobs={jobs} batchBaseUrl={basePath} batchId={batchId} />
      )}
    </div>
  );
}
