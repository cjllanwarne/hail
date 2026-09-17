import { useState } from 'react';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  TooltipContentProps,
} from 'recharts';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import type { JobListEntry, JobState, JobTimingEntry } from './useBatchData';

// The batch-timing API joins the *job's* current/final state onto every attempt row (there's no
// per-attempt success/failure column in the DB — see attempts table schema), which is only
// actually correct for the last attempt. But needing another attempt at all means an earlier one
// wasn't successful — so every non-last attempt gets one fixed "it was retried" color, with the
// real reason (preempted, cancelled, etc.) surfaced as text in the tooltip instead of a color.
type AttemptOutcome = JobState | 'Retried';

// Matches the state colors used for the batch-status SegmentedBar in pr.tsx (as hex, since SVG
// `fill` doesn't take Tailwind classes).
const OUTCOME_COLORS: Record<AttemptOutcome, string> = {
  Success: '#22c55e',
  Running: '#0ea5e9',
  Creating: '#7dd3fc',
  Ready: '#d4d4d8',
  Pending: '#e4e4e7',
  Failed: '#ef4444',
  Error: '#f97316',
  Cancelled: '#a1a1aa',
  Retried: '#71717a',
};

// One bar-segment within a job's row: `gapSec` is the time since the previous segment ended (or
// since the chart's global start, for a row's first segment) — i.e. what a stacked bar needs to
// render as an invisible spacer immediately before this segment's visible duration bar.
interface Segment {
  state: AttemptOutcome;
  reason: string | null; // only set for a 'Retried' segment — the attempt's own end reason
  gapSec: number;
  durationSec: number;
}

interface JobTimingRow {
  key: string;
  job_id: number;
  label: string;
  startMs: number;
  segments: Segment[];
}

function formatSeconds(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

function jobLabel(job_id: number, jobNameById: Map<number, string | null>): string {
  return jobNameById.get(job_id) ?? `Job ${job_id}`;
}

interface Attempt { startMs: number; endMs: number; state: JobState; reason: string | null }

// Groups timing entries by job, sorting each job's attempts by start time and sorting jobs by
// their first attempt's start time — the common prep both buildJobRows and buildAttemptRows need.
function groupAttemptsByJob(timing: JobTimingEntry[]): { job_id: number; attempts: Attempt[] }[] {
  const byJob = new Map<number, Attempt[]>();
  for (const entry of timing) {
    if (entry.start_time == null) continue;
    const endMs = entry.end_time ?? Date.now();
    const list = byJob.get(entry.job_id) ?? [];
    list.push({ startMs: entry.start_time, endMs, state: entry.state, reason: entry.reason });
    byJob.set(entry.job_id, list);
  }

  const groups = Array.from(byJob, ([job_id, attempts]) => {
    attempts.sort((a, b) => a.startMs - b.startMs);
    return { job_id, attempts };
  });
  groups.sort((a, b) => a.attempts[0].startMs - b.attempts[0].startMs);
  return groups;
}

// One row per job: a single segment spanning the earliest attempt's start to the latest
// attempt's end (or now, if the last attempt hasn't finished), collapsing any inter-attempt retry
// gaps rather than charting them.
function buildJobRows(timing: JobTimingEntry[], jobNameById: Map<number, string | null>): JobTimingRow[] {
  const groups = groupAttemptsByJob(timing);
  const globalStartMs = groups.length > 0 ? groups[0].attempts[0].startMs : 0;

  return groups.map(({ job_id, attempts }) => {
    const startMs = attempts[0].startMs;
    const endMs = Math.max(...attempts.map((a) => a.endMs));
    const state = attempts[attempts.length - 1].state;
    return {
      key: String(job_id),
      job_id,
      label: jobLabel(job_id, jobNameById),
      startMs,
      segments: [{ state, reason: null, gapSec: (startMs - globalStartMs) / 1000, durationSec: (endMs - startMs) / 1000 }],
    };
  });
}

// One row per job, but with one segment per attempt — so retry gaps show up as gaps between
// segments within the row, rather than being folded into a single job-wide span.
function buildAttemptRows(timing: JobTimingEntry[], jobNameById: Map<number, string | null>): JobTimingRow[] {
  const groups = groupAttemptsByJob(timing);
  const globalStartMs = groups.length > 0 ? groups[0].attempts[0].startMs : 0;

  return groups.map(({ job_id, attempts }) => {
    const segments: Segment[] = [];
    let prevEndMs = globalStartMs;
    attempts.forEach((a, i) => {
      // Only the chronologically last attempt actually reflects the job's current/final state —
      // the timing API joins that same state onto every attempt. Needing another attempt at all
      // means an earlier one didn't succeed, regardless of why, so every non-last attempt is
      // just 'Retried' — its actual reason shows up as text in the tooltip, not as a color.
      const isLast = i === attempts.length - 1;
      segments.push({
        state: isLast ? a.state : 'Retried',
        reason: isLast ? null : a.reason,
        gapSec: Math.max(0, a.startMs - prevEndMs) / 1000,
        durationSec: (a.endMs - a.startMs) / 1000,
      });
      prevEndMs = a.endMs;
    });
    return { key: String(job_id), job_id, label: jobLabel(job_id, jobNameById), startMs: attempts[0].startMs, segments };
  });
}

const ROW_HEIGHT_PX = 16;
const MAX_CHART_HEIGHT_PX = 600;

interface Props {
  timing: JobTimingEntry[];
  jobs: JobListEntry[] | null;
  batchBaseUrl: string;
  batchId: number;
}

// Flattens each row's variable-length `segments` array into the fixed `gap{i}`/`dur{i}` keys a
// stacked recharts Bar series needs — one gap/duration Bar pair per segment slot, shared across
// every row (rows with fewer segments than `segmentCount` get zero-width padding).
function toChartData(rows: JobTimingRow[], segmentCount: number): Record<string, unknown>[] {
  return rows.map((row) => {
    const rec: Record<string, unknown> = { key: row.key, label: row.label, _row: row };
    for (let i = 0; i < segmentCount; i++) {
      const seg: Segment | undefined = row.segments[i];
      rec[`gap${i}`] = seg?.gapSec ?? 0;
      rec[`dur${i}`] = seg?.durationSec ?? 0;
    }
    return rec;
  });
}

function TimingTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const row = (payload[0]?.payload as { _row: JobTimingRow })._row;
  return (
    <div className="bg-white border rounded shadow px-2 py-1 text-xs">
      <div className="font-semibold">{row.label}</div>
      {row.segments.map((seg, i) => (
        <div key={i}>
          {row.segments.length > 1 ? `Attempt ${i + 1}: ` : ''}
          {formatSeconds(seg.durationSec)} ({seg.state === 'Retried' ? (seg.reason ?? 'Retried') : seg.state})
        </div>
      ))}
    </div>
  );
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

  const segmentCount = Math.max(1, ...rows.map((row) => row.segments.length));
  const data = toChartData(rows, segmentCount);

  const handleClick = (bar: { payload?: Record<string, unknown> }): void => {
    const row = bar.payload?._row as JobTimingRow | undefined;
    if (row) window.open(`${batchBaseUrl}/batches/${batchId}/jobs/${row.job_id}`, '_blank');
  };

  return (
    // overflow-x-hidden: Recharts' Tooltip wrapper isn't clipped to the chart by default, so
    // hovering a bar near the right edge can push it just past the container and briefly summon
    // a horizontal scrollbar.
    <div className="overflow-y-auto overflow-x-hidden" style={{ maxHeight }}>
      <ResponsiveContainer width="100%" height={Math.max(height, ROW_HEIGHT_PX * rows.length)}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
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
          <Tooltip content={TimingTooltip} />
          {Array.from({ length: segmentCount }, (_, i) => (
            <Bar key={`gap${i}`} dataKey={`gap${i}`} stackId="timing" fill="transparent" isAnimationActive={false} />
          )).flatMap((gapBar, i) => [
            gapBar,
            <Bar
              key={`dur${i}`}
              dataKey={`dur${i}`}
              stackId="timing"
              isAnimationActive={false}
              cursor="pointer"
              onClick={handleClick}
            >
              {rows.map((row) => (
                <Cell key={row.key} fill={OUTCOME_COLORS[row.segments[i]?.state ?? 'Pending']} />
              ))}
            </Bar>,
          ])}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function JobTimingChart({ timing, jobs, batchBaseUrl, batchId }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [showAttempts, setShowAttempts] = useState(true);
  const jobNameById = new Map((jobs ?? []).map((j) => [j.job_id, j.name]));
  const rows = showAttempts ? buildAttemptRows(timing, jobNameById) : buildJobRows(timing, jobNameById);

  if (rows.length === 0) {
    return <p className="text-sm text-zinc-400 italic">No jobs have started yet.</p>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <label className="flex items-center gap-1.5 text-xs text-zinc-600">
          <input
            type="checkbox"
            checked={showAttempts}
            onChange={(e) => setShowAttempts(e.target.checked)}
          />
          Show individual attempts
        </label>
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
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                  <input
                    type="checkbox"
                    checked={showAttempts}
                    onChange={(e) => setShowAttempts(e.target.checked)}
                  />
                  Show individual attempts
                </label>
                <button
                  type="button"
                  className="text-xs text-sky-600 hover:underline"
                  onClick={() => setExpanded(false)}
                >
                  Close
                </button>
              </div>
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
