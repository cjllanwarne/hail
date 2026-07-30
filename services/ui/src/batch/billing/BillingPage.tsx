import { useState, useRef, useEffect } from 'react';
import { fetchJson } from './api';
import { fmtCost } from './fmt';
import { ErrorBanner } from './shared';

interface BillingRecord {
  billing_project: string;
  user: string;
  quote_name: string;
  total_spent: number;
}

type Tab = 'by-project' | 'by-user' | 'by-bp-user' | 'by-quote';

interface Props {
  basePath: string;
  isGlobalBm: boolean;
  initialStart: string;
  initialEnd: string;
}

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

function toCsv(rows: string[][], columns: string[]): string {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\n');
}

function mmddyyyyToIso(s: string): string {
  const [mm, dd, yyyy] = s.split('/');
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function firstOfMonthIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function firstOfMonthMmDdYyyy(): string {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}/01/${now.getFullYear()}`;
}

function buildCsv(records: BillingRecord[], tab: Tab): { csv: string; filename: string; startLabel: string; endLabel: string } {
  const startLabel = (document.getElementById('billing-start') as HTMLInputElement | null)?.value ?? '';
  const endLabel = (document.getElementById('billing-end') as HTMLInputElement | null)?.value ?? '';
  const startIso = startLabel ? mmddyyyyToIso(startLabel) : firstOfMonthIso();
  const endIso = endLabel ? mmddyyyyToIso(endLabel) : todayIso();

  let csv: string;
  let label: string;

  if (tab === 'by-project') {
    const acc = new Map<string, number>();
    for (const r of records) acc.set(r.billing_project, (acc.get(r.billing_project) ?? 0) + r.total_spent);
    const rows = [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([bp, cost]) => [bp, String(cost)]);
    csv = toCsv(rows, ['billing_project', 'total_spent']);
    label = 'by billing project';
  } else if (tab === 'by-user') {
    const acc = new Map<string, number>();
    for (const r of records) acc.set(r.user, (acc.get(r.user) ?? 0) + r.total_spent);
    const rows = [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([u, cost]) => [u, String(cost)]);
    csv = toCsv(rows, ['user', 'total_spent']);
    label = 'by user';
  } else if (tab === 'by-quote') {
    const acc = new Map<string, number>();
    for (const r of records) acc.set(r.quote_name, (acc.get(r.quote_name) ?? 0) + r.total_spent);
    const rows = [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([q, cost]) => [q, String(cost)]);
    csv = toCsv(rows, ['quote_name', 'total_spent']);
    label = 'by quote';
  } else {
    const rows = [...records]
      .sort((a, b) => a.billing_project.localeCompare(b.billing_project) || a.user.localeCompare(b.user))
      .map((r) => [r.billing_project, r.user, String(r.total_spent)]);
    csv = toCsv(rows, ['billing_project', 'user', 'total_spent']);
    label = 'by billing project and user';
  }

  return { csv, filename: `Hail billing export ${startIso} to ${endIso} ${label}.csv`, startLabel, endLabel };
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 pt-4 pb-2 text-lg hover:opacity-100 hover:cursor-pointer border-black ${active ? 'border-b opacity-100' : 'opacity-50'}`}
    >
      {label}
    </button>
  );
}

function SummaryTable({ rows, columns }: { rows: [string, string][]; columns: [string, string] }) {
  return (
    <table className="w-full overflow-auto">
      <tbody>
        {rows.map(([a, b]) => (
          <tr key={a} className="border-y">
            <td className="p-2">{a}</td>
            <td className="p-2">{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TwoColumnTable({ rows, columns }: { rows: [string, string, string][]; columns: [string, string, string] }) {
  return (
    <table className="w-full overflow-auto">
      <tbody>
        {rows.map(([a, b, c], i) => (
          <tr key={i} className="border-y">
            <td className="p-2">{a}</td>
            <td className="p-2">{b}</td>
            <td className="p-2">{c}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function BillingPage({ basePath, isGlobalBm, initialStart, initialEnd }: Props) {
  const [start, setStart] = useState(initialStart || firstOfMonthMmDdYyyy());
  const [end, setEnd] = useState(initialEnd);
  const [records, setRecords] = useState<BillingRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(isGlobalBm ? 'by-project' : 'by-bp-user');
  const [exportStatus, setExportStatus] = useState('');
  const exportStatusTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = async (startVal: string, endVal: string) => {
    setLoading(true);
    setError(null);
    setRecords(null);
    const params = new URLSearchParams({ start: startVal });
    if (endVal) params.set('end', endVal);
    try {
      const data = await fetchJson<BillingRecord[]>(`${basePath}/api/v1alpha/billing?${params}`);
      setRecords(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData(start, end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetchData(start, end);
  };

  const totalCost = records ? fmtCost(records.reduce((s, r) => s + r.total_spent, 0)) : null;

  const byProject: [string, string][] = records
    ? (() => {
        const acc = new Map<string, number>();
        for (const r of records) acc.set(r.billing_project, (acc.get(r.billing_project) ?? 0) + r.total_spent);
        return [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([bp, cost]): [string, string] => [bp, fmtCost(cost) || '$0']);
      })()
    : [];

  const byUser: [string, string][] = records
    ? (() => {
        const acc = new Map<string, number>();
        for (const r of records) acc.set(r.user, (acc.get(r.user) ?? 0) + r.total_spent);
        return [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([u, cost]): [string, string] => [u, fmtCost(cost) || '$0']);
      })()
    : [];

  const byBpUser: [string, string, string][] = records
    ? [...records]
        .sort((a, b) => a.billing_project.localeCompare(b.billing_project) || a.user.localeCompare(b.user))
        .map((r): [string, string, string] => [r.billing_project, r.user, fmtCost(r.total_spent) || '$0'])
    : [];

  const byQuote: [string, string][] = records
    ? (() => {
        const acc = new Map<string, number>();
        for (const r of records) acc.set(r.quote_name, (acc.get(r.quote_name) ?? 0) + r.total_spent);
        return [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([q, cost]): [string, string] => [q, fmtCost(cost) || '$0']);
      })()
    : [];

  const doExport = (action: 'download' | 'copy') => {
    if (!records) return;
    const { csv, filename } = buildCsv(records, tab);

    if (action === 'download') {
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showExportStatus('✓ Done');
    } else {
      navigator.clipboard.writeText(csv).then(() => showExportStatus('✓ Done')).catch(() => showExportStatus('Failed'));
    }
  };

  const showExportStatus = (msg: string) => {
    setExportStatus(msg);
    if (exportStatusTimeout.current) clearTimeout(exportStatusTimeout.current);
    exportStatusTimeout.current = setTimeout(() => setExportStatus(''), 1500);
  };

  return (
    <div className="flex flex-wrap justify-around items-start md:mt-16">
      <div className="lg:basis-1/3">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-light">Billing</h1>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="flex flex-wrap justify-between space-y-2 items-end">
            <div className="flex flex-col">
              <label className="mb-1" htmlFor="billing-start">Start</label>
              <input
                id="billing-start"
                className="border rounded p-2"
                name="start"
                type="text"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
                placeholder="MM/DD/YYYY"
              />
            </div>
            <div className="flex flex-col">
              <label className="mb-1" htmlFor="billing-end">End (inclusive)</label>
              <input
                id="billing-end"
                className="border rounded p-2"
                name="end"
                type="text"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                placeholder="MM/DD/YYYY (optional)"
              />
            </div>
            <div className="h-1/2">
              <button
                type="submit"
                disabled={loading}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Loading…' : 'Submit'}
              </button>
            </div>
          </div>
        </form>

        <p className="text-zinc-500 text-balance py-8">
          Start must be a date in the format MM/DD/YYYY. End is an optional date in the format
          MM/DD/YYYY. Leave End empty to include currently running batches. If End is not empty,
          then no currently running batches are included. All dates search for batches that have
          completed within that time interval (inclusive).
        </p>

        {records && (
          <details className="mt-4 border rounded">
            <summary className="p-3 cursor-pointer font-medium select-none">Export to spreadsheet</summary>
            <div className="p-4 space-y-3">
              <p className="text-sm text-zinc-500">
                Dates: <span className="font-medium">{start}</span> to{' '}
                <span className="font-medium">{end || 'today'}</span>{' '}
                <span className="italic">
                  ({end ? 'currently-running batches excluded' : 'including currently-running batches'})
                </span>
              </p>
              <p className="text-sm text-zinc-500">Exports the currently selected tab.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => doExport('download')}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm"
                >
                  Download CSV
                </button>
                <button
                  onClick={() => doExport('copy')}
                  className="border border-blue-600 text-blue-600 px-4 py-2 rounded hover:bg-blue-50 text-sm"
                >
                  Copy to Clipboard
                </button>
              </div>
              {exportStatus && <p className="text-sm text-zinc-500">{exportStatus}</p>}
            </div>
          </details>
        )}
      </div>

      <div className="bg-slate-100 border rounded overflow-hidden lg:basis-1/2">
        {error && <ErrorBanner message={error} />}

        {loading && (
          <div className="flex items-center justify-center p-12">
            <span className="text-3xl font-light text-sky-600">Loading&hellip;</span>
          </div>
        )}

        {!loading && records && (
          <>
            <div className="text-xl m-4">
              Total spend: <span className="font-light text-lg">{totalCost}</span>
            </div>
            <div className="bg-white">
              <div className="flex border-b text-lg flex-wrap">
                {isGlobalBm && <TabButton label="By Billing Project" active={tab === 'by-project'} onClick={() => setTab('by-project')} />}
                {isGlobalBm && <TabButton label="By User" active={tab === 'by-user'} onClick={() => setTab('by-user')} />}
                <TabButton label="By Billing Project and User" active={tab === 'by-bp-user'} onClick={() => setTab('by-bp-user')} />
                {isGlobalBm && <TabButton label="By Quote" active={tab === 'by-quote'} onClick={() => setTab('by-quote')} />}
              </div>

              {tab === 'by-project' && <SummaryTable rows={byProject} columns={['Billing Project', 'Cost']} />}
              {tab === 'by-user' && <SummaryTable rows={byUser} columns={['User', 'Cost']} />}
              {tab === 'by-bp-user' && <TwoColumnTable rows={byBpUser} columns={['Billing Project', 'User', 'Cost']} />}
              {tab === 'by-quote' && <SummaryTable rows={byQuote} columns={['Quote', 'Cost']} />}
            </div>
          </>
        )}

        {!loading && !records && !error && (
          <div className="p-8 text-slate-500 text-sm">No results.</div>
        )}
      </div>
    </div>
  );
}
