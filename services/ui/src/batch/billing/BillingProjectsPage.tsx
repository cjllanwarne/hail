import { useState, useEffect, useCallback } from 'react';
import type { BillingProject } from './api';
import { fetchJson, apiCall } from './api';
import { fmtDollars, fmtCost } from './fmt';
import { ErrorBanner } from './shared';

interface Props {
  basePath: string;
  isGlobalBm: boolean;
  canCreateBp: boolean;
  canCreateQuotes: boolean;
}

function isLowBudget(bp: BillingProject): boolean {
  return bp.remaining !== null && bp.low_budget_alert !== null && bp.remaining < bp.low_budget_alert;
}

function BpRow({ bp, basePath }: { bp: BillingProject; basePath: string }) {
  const low = isLowBudget(bp);
  return (
    <tr className={`border-t hover:bg-slate-50 ${low ? 'bg-amber-50' : ''}`}>
      <td className="pl-3 py-2">
        <a href={`${basePath}/billing_projects/${bp.billing_project}`} className="text-blue-600 hover:underline">
          {bp.billing_project}
        </a>
      </td>
      <td className="py-2">
        <a href={`${basePath}/billing/quotes/${bp.quote_name}`} className="text-blue-600 hover:underline">
          {bp.quote_name}
        </a>
      </td>
      <td className="py-2">{fmtDollars(bp.limit)}</td>
      <td className="py-2">{fmtCost(bp.accrued_cost)}</td>
      <td className={`py-2 ${low ? 'text-amber-700 font-medium' : ''}`}>{fmtDollars(bp.remaining)}</td>
    </tr>
  );
}

function CreateBpModal({
  basePath,
  onClose,
  onCreated,
}: {
  basePath: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [quoteName, setQuoteName] = useState('');
  const [limit, setLimit] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!quoteName.trim()) { setError('Quote name is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      await apiCall('POST', `${basePath}/api/v1alpha/billing_projects/${encodeURIComponent(name)}/create`, {
        quote_name: quoteName,
        limit: limit === '' ? null : parseFloat(limit),
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white rounded shadow-lg w-full max-w-md p-6">
        <h2 className="text-xl font-light mb-4">New Billing Project</h2>
        <div className="space-y-3 text-sm">
          <div>
            <label className="block mb-1 text-slate-600">Name <span className="text-red-500">*</span></label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="border rounded px-2 py-1 w-full" spellCheck={false} autoCorrect="off"
            />
          </div>
          <div>
            <label className="block mb-1 text-slate-600">Quote Name <span className="text-red-500">*</span></label>
            <input
              type="text" value={quoteName} onChange={(e) => setQuoteName(e.target.value)}
              className="border rounded px-2 py-1 w-full" spellCheck={false} autoCorrect="off"
            />
          </div>
          <div>
            <label className="block mb-1 text-slate-600">Limit (dollars, or leave blank for unlimited)</label>
            <input
              type="number" min="0" step="0.01" value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="border rounded px-2 py-1 w-full" placeholder="e.g. 10000"
            />
          </div>
        </div>
        {error && <div className="text-red-600 text-xs mt-2">{error}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="border border-gray-300 px-3 py-1.5 rounded text-sm hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

export function BillingProjectsPage({ basePath, isGlobalBm, canCreateBp, canCreateQuotes }: Props) {
  const [bps, setBps] = useState<BillingProject[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const data = await fetchJson<BillingProject[]>(`${basePath}/api/v1alpha/billing_projects`);
      setBps(data);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [basePath]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const openBps = bps?.filter((bp) => bp.status === 'open') ?? [];
  const closedBps = bps?.filter((bp) => bp.status === 'closed') ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-2xl font-light">
          <a href={`${basePath}/billing/quotes`} className="text-slate-400 hover:text-slate-600">Quotes</a>
          <span className="text-slate-300">›</span>
          <span>Billing Projects</span>
        </div>
        <div className="flex items-center gap-3">
          {canCreateBp && (
            <button
              onClick={() => setShowCreate(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
            >
              New Billing Project
            </button>
          )}
          <a
            href={`${basePath}/set_ui_style?style=classic&redirect=/billing_projects`}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            Back to classic layout
          </a>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading && (
        <div className="flex items-center justify-center mt-12">
          <span className="text-3xl font-light text-sky-600">Loading&hellip;</span>
        </div>
      )}

      {!loading && !error && (
        <>
          {openBps.length > 0 ? (
            <table className="w-full overflow-hidden rounded border text-sm mb-4">
              <thead>
                <tr>
                  <th className="h-10 bg-slate-200 font-normal pl-3 text-left">Name</th>
                  <th className="h-10 bg-slate-200 font-normal text-left">Quote</th>
                  <th className="h-10 bg-slate-200 font-normal text-left">Limit</th>
                  <th className="h-10 bg-slate-200 font-normal text-left">Accrued</th>
                  <th className="h-10 bg-slate-200 font-normal text-left">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {openBps.map((bp) => <BpRow key={bp.billing_project} bp={bp} basePath={basePath} />)}
              </tbody>
            </table>
          ) : (
            !closedBps.length && <p className="text-slate-500 mt-4 text-sm">No billing projects found.</p>
          )}

          {closedBps.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-slate-500 text-sm select-none mb-2">
                {closedBps.length} closed project{closedBps.length !== 1 ? 's' : ''}
              </summary>
              <table className="w-full overflow-hidden rounded border text-sm">
                <tbody>
                  {closedBps.map((bp) => (
                    <tr key={bp.billing_project} className="border-t bg-slate-50 hover:bg-slate-100">
                      <td className="pl-3 py-2 italic text-slate-500">
                        <a href={`${basePath}/billing_projects/${bp.billing_project}`} className="text-blue-600 hover:underline">
                          {bp.billing_project}
                        </a>
                      </td>
                      <td className="py-2 text-slate-500">{bp.quote_name}</td>
                      <td className="py-2 text-slate-500">{fmtDollars(bp.limit)}</td>
                      <td className="py-2 text-slate-500">{fmtCost(bp.accrued_cost)}</td>
                      <td className="py-2 text-slate-500">{fmtDollars(bp.remaining)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}

      {showCreate && (
        <CreateBpModal
          basePath={basePath}
          onClose={() => setShowCreate(false)}
          onCreated={() => void fetchData()}
        />
      )}
    </div>
  );
}
