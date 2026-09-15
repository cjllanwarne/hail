import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { JobState, JobTimingEntry } from '../../batch/components/useBatchData';

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
function buildRows(timing: JobTimingEntry[]): JobTimingRow[] {
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
    rows.push({ job_id, label: `Job ${job_id}`, state, startMs, endMs, offsetSec: 0, durationSec: 0 });
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

interface Props { timing: JobTimingEntry[] }

export function JobTimingChart({ timing }: Props): JSX.Element {
  const rows = buildRows(timing);

  if (rows.length === 0) {
    return <p className="text-sm text-zinc-400 italic">No jobs have started yet.</p>;
  }

  const height = Math.min(rows.length * ROW_HEIGHT_PX, MAX_CHART_HEIGHT_PX);

  return (
    <div className="overflow-y-auto" style={{ maxHeight: MAX_CHART_HEIGHT_PX }}>
      <ResponsiveContainer width="100%" height={Math.max(height, ROW_HEIGHT_PX * rows.length)}>
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
          <XAxis type="number" tickFormatter={formatSeconds} tick={{ fontSize: 10 }} />
          <YAxis type="category" dataKey="label" width={80} tick={{ fontSize: 10 }} />
          <Tooltip
            formatter={(value, name) => (name === 'durationSec' ? formatSeconds(value as number) : value)}
            labelFormatter={(label, payload) => {
              const row = payload?.[0]?.payload as JobTimingRow | undefined;
              return row ? `${label} (${row.state})` : label;
            }}
          />
          <Bar dataKey="offsetSec" stackId="timing" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="durationSec" stackId="timing" isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.job_id} fill={STATE_COLORS[row.state]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
