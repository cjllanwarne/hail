import { useState } from 'react';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { JobListEntry, JobState, JobTimingEntry } from '../../batch/components/useBatchData';

// Matches the state colors used for the batch-status SegmentedBar in pr.tsx (as hex, since SVG
// `fill` doesn't take Tailwind classes).
const STATE_COLORS: Record<JobState, string> = {
  Success: '#22c55e',
  Running: '#0ea5e9',
  Creating: '#7dd3fc',
  Ready: '#d4d4d8',
  Pending: '#e4e4e7',
  Failed: '#ef4444',
  Error: '#f97316',
  Cancelled: '#a1a1aa',
};

interface JobTimingRow {
  job_id: number;
  label: string;
  state: JobState;
  startMs: number;
  endMs: number;
  offsetSec: number;
  durationSec: number;
}

function formatSeconds(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

// One row per job: spans from the earliest attempt's start to the latest attempt's end (or now,
// if the last attempt hasn't finished), collapsing any inter-attempt retry gaps rather than
// charting them — a per-attempt breakdown can come later if it's needed.
function buildRows(timing: JobTimingEntry[], jobNameById: Map<number, string | null>): JobTimingRow[] {
  const byJob = new Map<number, { state: JobState; startMs: number | null; endMs: number | null }>();
  for (const entry of timing) {
    if (entry.start_time == null) continue;
    const existing = byJob.get(entry.job_id);
    const endMs = entry.end_time ?? Date.now();
    if (existing) {
      existing.state = entry.state;
      existing.startMs = Math.min(existing.startMs!, entry.start_time);
      existing.endMs = Math.max(existing.endMs!, endMs);
    } else {
      byJob.set(entry.job_id, { state: entry.state, startMs: entry.start_time, endMs });
    }
  }

  const rows: JobTimingRow[] = [];
  for (const [job_id, { state, startMs, endMs }] of byJob) {
    if (startMs == null || endMs == null) continue;
    const label = jobNameById.get(job_id) ?? `Job ${job_id}`;
    rows.push({ job_id, label, state, startMs, endMs, offsetSec: 0, durationSec: 0 });
  }
  rows.sort((a, b) => a.startMs - b.startMs);

  const globalStartMs = rows.length > 0 ? rows[0].startMs : 0;
  for (const row of rows) {
    row.offsetSec = (row.startMs - globalStartMs) / 1000;
    row.durationSec = (row.endMs - row.startMs) / 1000;
  }
  return rows;
}

const ROW_HEIGHT_PX = 16;
const MAX_CHART_HEIGHT_PX = 600;

interface Props {
  timing: JobTimingEntry[];
  jobs: JobListEntry[] | null;
  batchBaseUrl: string;
  batchId: number;
}

function Chart({ rows, maxHeight, batchBaseUrl, batchId }: {
  rows: JobTimingRow[];
  maxHeight: number;
  batchBaseUrl: string;
  batchId: number;
}): JSX.Element {
  const height = Math.min(rows.length * ROW_HEIGHT_PX, maxHeight);
  // Rough monospace-ish estimate (px/char at fontSize 10) rather than measuring text, clamped so
  // one very long job name can't swallow the whole chart width.
  const maxLabelLen = rows.reduce((max, row) => Math.max(max, row.label.length), 0);
  const yAxisWidth = Math.min(Math.max(maxLabelLen * 6 + 16, 120), 320);

  return (
    // overflow-x-hidden: Recharts' Tooltip wrapper isn't clipped to the chart by default, so
    // hovering a bar near the right edge can push it just past the container and briefly summon
    // a horizontal scrollbar.
    <div className="overflow-y-auto overflow-x-hidden" style={{ maxHeight }}>
      <ResponsiveContainer width="100%" height={Math.max(height, ROW_HEIGHT_PX * rows.length)}>
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
          <XAxis type="number" tickFormatter={formatSeconds} tick={{ fontSize: 10 }} />
          {/* interval={0}: Recharts' default tick-skipping to avoid overlap otherwise hides
              roughly half the labels at this row height. */}
          <YAxis
            type="category"
            dataKey="label"
            width={yAxisWidth}
            tick={{ fontSize: 10, fontFamily: 'monospace' }}
            interval={0}
          />
          <Tooltip
            formatter={(value, name) => (name === 'durationSec' ? formatSeconds(value as number) : value)}
            labelFormatter={(label, payload) => {
              const row = payload?.[0]?.payload as JobTimingRow | undefined;
              return row ? `${label} (${row.state})` : label;
            }}
          />
          <Bar dataKey="offsetSec" stackId="timing" fill="transparent" isAnimationActive={false} />
          <Bar
            dataKey="durationSec"
            stackId="timing"
            isAnimationActive={false}
            cursor="pointer"
            onClick={(bar) => {
              const row = bar.payload as JobTimingRow;
              window.open(`${batchBaseUrl}/batches/${batchId}/jobs/${row.job_id}`, '_blank');
            }}
          >
            {rows.map((row) => <Cell key={row.job_id} fill={STATE_COLORS[row.state]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function JobTimingChart({ timing, jobs, batchBaseUrl, batchId }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const jobNameById = new Map((jobs ?? []).map((j) => [j.job_id, j.name]));
  const rows = buildRows(timing, jobNameById);

  if (rows.length === 0) {
    return <p className="text-sm text-zinc-400 italic">No jobs have started yet.</p>;
  }

  return (
    <div>
      <div className="flex justify-end mb-1">
        <button
          type="button"
          className="text-xs text-sky-600 hover:underline"
          onClick={() => setExpanded(true)}
        >
          Expand
        </button>
      </div>
      <Chart rows={rows} maxHeight={MAX_CHART_HEIGHT_PX} batchBaseUrl={batchBaseUrl} batchId={batchId} />

      {expanded && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded shadow-lg w-full h-full max-w-[95vw] p-4 flex flex-col">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-semibold text-zinc-600">Job Timing</h3>
              <button
                type="button"
                className="text-xs text-sky-600 hover:underline"
                onClick={() => setExpanded(false)}
              >
                Close
              </button>
            </div>
            {/* No inner cap here — the outer flex-1/overflow-y-auto div is the one scrollbar,
                so the chart itself renders at its full (uncapped) height. */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              <Chart
                rows={rows}
                maxHeight={rows.length * ROW_HEIGHT_PX}
                batchBaseUrl={batchBaseUrl}
                batchId={batchId}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
