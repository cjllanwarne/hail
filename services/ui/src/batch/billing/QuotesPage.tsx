import { useState, useEffect, useCallback } from 'react';
import type { Quote } from './api';
import { fetchJson, apiCall } from './api';
import { fmtDollars } from './fmt';
import { ErrorBanner, QuoteCompactBudgetBar } from './shared';

type SortKey = 'name' | 'cost_object' | 'pi_name' | 'pm_designee' | 'spent' | 'allocated' | 'limit' | 'usage';
type SortDir = 'asc' | 'desc';

const SORT_DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: 'asc',
  cost_object: 'asc',
  pi_name: 'asc',
  pm_designee: 'asc',
  spent: 'desc',
  allocated: 'desc',
  limit: 'desc',
  usage: 'desc',
};

function totalSpent(q: Quote): number {
  return (q.billing_projects ?? []).reduce((s, bp) => s + bp.accrued_cost, 0);
}

function totalAllocated(q: Quote): number {
  return (q.billing_projects ?? []).reduce((s, bp) => s + (bp.limit ?? 0), 0);
}

function sortQuotes(quotes: Quote[], key: SortKey, dir: SortDir): Quote[] {
  return [...quotes].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case 'name':      cmp = a.name.localeCompare(b.name); break;
      case 'cost_object': cmp = a.cost_object.localeCompare(b.cost_object); break;
      case 'pi_name':   cmp = (a.pi_name ?? '').localeCompare(b.pi_name ?? ''); break;
      case 'pm_designee': cmp = (a.pm_designee ?? '').localeCompare(b.pm_designee ?? ''); break;
      case 'spent':     cmp = totalSpent(a) - totalSpent(b); break;
      case 'allocated': cmp = totalAllocated(a) - totalAllocated(b); break;
      case 'limit':
        if (a.authorized_amount === null && b.authorized_amount === null) cmp = 0;
        else if (a.authorized_amount === null) cmp = 1;
        else if (b.authorized_amount === null) cmp = -1;
        else cmp = a.authorized_amount - b.authorized_amount;
        break;
      case 'usage': {
        const pA = a.authorized_amount === null ? 0 : totalAllocated(a) / a.authorized_amount;
        const pB = b.authorized_amount === null ? 0 : totalAllocated(b) / b.authorized_amount;
        cmp = pA - pB;
        break;
      }
    }
    return dir === 'asc' ? cmp : -cmp;
  });
}

function SortTh({ label, sortKey, current, dir, onSort }: {
  label: string; sortKey: SortKey; current: SortKey; dir: SortDir; onSort: (k: SortKey) => void;
}) {
  const active = sortKey === current;
  return (
    <th className="text-left p-3 font-medium cursor-pointer select-none hover:bg-slate-100" onClick={() => onSort(sortKey)}>
      <div className="flex items-center gap-1">
        {label}
        <span className="material-symbols-outlined text-sm text-slate-400">
          {active ? (dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
        </span>
      </div>
    </th>
  );
}

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
  const [quoteNumber, setQuoteNumber] = useState('');
  const [costObject, setCostObject] = useState('');
  const [authorizedAmount, setAuthorizedAmount] = useState('');
  const [piName, setPiName] = useState('');
  const [pmDesignee, setPmDesignee] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!costObject.trim()) { setError('Cost Object is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      await apiCall('POST', `${basePath}/api/v1alpha/quotes/${encodeURIComponent(name)}`, {
        quote_number: quoteNumber || null,
        cost_object: costObject,
        authorized_amount: authorizedAmount === '' ? 'unlimited' : parseFloat(authorizedAmount),
        pi_name: piName || null,
        pm_designee: pmDesignee || null,
        description: description || null,
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
            <label className="block mb-1 text-slate-600">Quote Number</label>
            <input
              type="text" value={quoteNumber} onChange={(e) => setQuoteNumber(e.target.value)}
              className="border rounded px-2 py-1 w-full" spellCheck={false} placeholder="e.g. Q-2026-001"
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
          <div>
            <label className="block mb-1 text-slate-600">Description</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
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
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(SORT_DEFAULT_DIR[key]); }
  };

  const fetchData = useCallback(async () => {
    try {
      const list = await fetchJson<Quote[]>(`${basePath}/api/v1alpha/quotes`);
      const details = await Promise.all(
        list.map((q) => fetchJson<Quote>(`${basePath}/api/v1alpha/quotes/${encodeURIComponent(q.name)}`))
      );
      setQuotes(details);
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
        <div className="flex items-center gap-2 text-2xl font-light">
          <span className="text-slate-400">Billing</span>
          <span className="text-slate-300">›</span>
          <span>Quotes</span>
        </div>
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
          <table className="w-full overflow-hidden rounded border text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10">
              <tr>
                <SortTh label="Name"        sortKey="name"        current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Cost Object" sortKey="cost_object" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="PI Name"     sortKey="pi_name"     current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="PM Designee" sortKey="pm_designee" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Authorized"  sortKey="limit"       current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Allocated"   sortKey="allocated"   current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Spent"       sortKey="spent"       current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortTh label="Usage"       sortKey="usage"       current={sortKey} dir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {sortQuotes(quotes, sortKey, sortDir).map((q) => {
                const spent = totalSpent(q);
                const allocated = totalAllocated(q);
                return (
                  <tr key={q.id} className="border-t hover:bg-slate-50">
                    <td className="p-3">
                      <a href={`${basePath}/billing/quotes/${q.name}`} className="text-blue-600 hover:underline">
                        {q.name}
                      </a>
                    </td>
                    <td className="p-3 text-slate-700">{q.cost_object}</td>
                    <td className="p-3 text-slate-700">{q.pi_name ?? '—'}</td>
                    <td className="p-3 text-slate-700">{q.pm_designee ?? '—'}</td>
                    <td className="p-3 text-slate-700">{fmtDollars(q.authorized_amount)}</td>
                    <td className="p-3 text-slate-700">{fmtDollars(allocated)}</td>
                    <td className="p-3 text-slate-700">{fmtDollars(spent)}</td>
                    <td className="p-3">
                      <QuoteCompactBudgetBar spent={spent} allocated={allocated} authorized={q.authorized_amount} />
                    </td>
                  </tr>
                );
              })}
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
