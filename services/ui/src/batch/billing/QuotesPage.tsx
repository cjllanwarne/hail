import { useState, useEffect, useCallback } from 'react';
import type { Quote } from './api';
import { fetchJson, apiCall } from './api';
import { fmtDollars } from './fmt';
import { ErrorBanner } from './shared';

interface Props {
  basePath: string;
  canCreate: boolean;
}

function CreateQuoteModal({
  basePath,
  onClose,
  onCreated,
}: {
  basePath: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [costObject, setCostObject] = useState('');
  const [authorizedAmount, setAuthorizedAmount] = useState('');
  const [piName, setPiName] = useState('');
  const [pmDesignee, setPmDesignee] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!costObject.trim()) { setError('Cost Object is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      await apiCall('POST', `${basePath}/api/v1alpha/quotes/${encodeURIComponent(name)}`, {
        cost_object: costObject,
        authorized_amount: authorizedAmount === '' ? 'unlimited' : parseFloat(authorizedAmount),
        pi_name: piName || null,
        pm_designee: pmDesignee || null,
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
        <h2 className="text-xl font-light mb-4">New Quote</h2>
        <div className="space-y-3 text-sm">
          <div>
            <label className="block mb-1 text-slate-600">Name <span className="text-red-500">*</span></label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              className="border rounded px-2 py-1 w-full" spellCheck={false}
            />
          </div>
          <div>
            <label className="block mb-1 text-slate-600">Cost Object <span className="text-red-500">*</span></label>
            <input
              type="text" value={costObject} onChange={(e) => setCostObject(e.target.value)}
              className="border rounded px-2 py-1 w-full" spellCheck={false}
            />
          </div>
          <div>
            <label className="block mb-1 text-slate-600">Authorized Amount (dollars, or leave blank for unlimited)</label>
            <input
              type="number" min="0" step="0.01" value={authorizedAmount}
              onChange={(e) => setAuthorizedAmount(e.target.value)}
              className="border rounded px-2 py-1 w-full" placeholder="e.g. 10000"
            />
          </div>
          <div>
            <label className="block mb-1 text-slate-600">PI Name</label>
            <input type="text" value={piName} onChange={(e) => setPiName(e.target.value)}
              className="border rounded px-2 py-1 w-full" />
          </div>
          <div>
            <label className="block mb-1 text-slate-600">PM Designee</label>
            <input type="text" value={pmDesignee} onChange={(e) => setPmDesignee(e.target.value)}
              className="border rounded px-2 py-1 w-full" />
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

export function QuotesPage({ basePath, canCreate }: Props) {
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const data = await fetchJson<Quote[]>(`${basePath}/api/v1alpha/quotes`);
      setQuotes(data);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [basePath]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-light">Quotes</h1>
        {canCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
          >
            New Quote
          </button>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      {loading && (
        <div className="flex items-center justify-center mt-12">
          <span className="text-3xl font-light text-sky-600">Loading&hellip;</span>
        </div>
      )}

      {!loading && !error && (
        quotes && quotes.length > 0 ? (
          <table className="table-fixed w-full overflow-hidden rounded border text-sm">
            <thead>
              <tr>
                <th className="h-10 bg-slate-200 font-normal pl-3 text-left">Name</th>
                <th className="h-10 bg-slate-200 font-normal text-left">Cost Object</th>
                <th className="h-10 bg-slate-200 font-normal text-left">PI</th>
                <th className="h-10 bg-slate-200 font-normal text-left">PM Designee</th>
                <th className="h-10 bg-slate-200 font-normal text-left">Authorized Amount</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id} className="border-t hover:bg-slate-50">
                  <td className="pl-3 py-2">
                    <a href={`${basePath}/billing/quotes/${q.name}`} className="text-blue-600 hover:underline">
                      {q.name}
                    </a>
                  </td>
                  <td className="py-2">{q.cost_object}</td>
                  <td className="py-2">{q.pi_name ?? ''}</td>
                  <td className="py-2">{q.pm_designee ?? ''}</td>
                  <td className="py-2">{fmtDollars(q.authorized_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-slate-500 mt-4">No quotes found.</p>
        )
      )}

      {showCreate && (
        <CreateQuoteModal
          basePath={basePath}
          onClose={() => setShowCreate(false)}
          onCreated={() => void fetchData()}
        />
      )}
    </div>
  );
}
