import { useEffect, useState } from 'react';
import { useBatchData } from './useBatchData';
import { JobGraphView } from './JobGraphView';

interface Props { basePath: string; batchId: number }

// Standalone "Try batch graph" widget for the classic (Jinja2) batch-details page — mounts its own
// useBatchData instance rather than being fed one, since the classic page doesn't have a React
// data layer for it to plug into. Mirrors BatchTimingWidget's click-to-reveal pattern.
export function BatchGraphWidget({ basePath, batchId }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const batchData = useBatchData(basePath, batchId);
  const { refresh, fetchJobGraph, jobGraph, jobGraphError } = batchData;

  useEffect(() => {
    refresh(false);
  }, [refresh]);

  if (!open) {
    return (
      <button
        type="button"
        className="text-sm text-sky-600 hover:underline"
        onClick={() => { setOpen(true); fetchJobGraph(); }}
      >
        Try batch graph
      </button>
    );
  }

  return (
    <div className="mt-2 border rounded p-3">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm font-semibold text-zinc-600">Batch Graph</h3>
        <button type="button" className="text-xs text-sky-600 hover:underline" onClick={() => setOpen(false)}>
          Hide
        </button>
      </div>
      {jobGraphError ? (
        <p className="text-sm text-red-600">{jobGraphError}</p>
      ) : jobGraph === undefined ? (
        <p className="text-sm text-zinc-500">Loading job graph&hellip;</p>
      ) : (
        <JobGraphView
          jobs={batchData.jobs}
          jobGraph={jobGraph}
          jobGroupTree={batchData.jobGroupTree}
          jobGroupTreeError={batchData.jobGroupTreeError}
          fetchJobGroupTree={batchData.fetchJobGroupTree}
          batchBaseUrl={basePath}
          batchId={batchId}
          batchName={batchData.batchStatus?.attributes?.name}
        />
      )}
    </div>
  );
}
