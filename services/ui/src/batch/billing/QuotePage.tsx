import { useState, useEffect, useCallback } from 'react';
import type { Quote, BillingProject, BillingEvent } from './api';
import { fetchJson, apiCall } from './api';
import { fmtDollars, fmtCost, fmtTimestamp } from './fmt';
import type { BillingRole } from './permissions';
import { can } from './permissions';
import { SectionHeader, ErrorBanner, EditableRow, EventLog } from './shared';

interface Props {
  basePath: string;
  quoteName: string;
  billingRole: BillingRole;
}

const QUOTE_EVENT_COLUMNS = [
  { key: 'timestamp' as const, label: 'Time', render: (v: unknown) => <span className="whitespace-nowrap text-slate-500">{fmtTimestamp(v as number)}</span> },
  { key: 'actor' as const, label: 'Actor' },
  { key: 'action' as const, label: 'Action' },
  { key: 'target_user' as const, label: 'Target User' },
  { key: 'target_project' as const, label: 'Target Project' },
  { key: 'detail' as const, label: 'Detail' },
  { key: 'comment' as const, label: 'Comment', render: (v: unknown) => <span className="text-slate-500 italic">{String(v ?? '')}</span> },
];

function isLowBudget(bp: BillingProject): boolean {
  return bp.remaining !== null && bp.low_budget_alert !== null && bp.remaining < bp.low_budget_alert;
}

export function QuotePage({ basePath, quoteName, billingRole }: Props) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [events, setEvents] = useState<BillingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addMgrUser, setAddMgrUser] = useState('');
  const [addMgrRole, setAddMgrRole] = useState('manager');
  const [mgrError, setMgrError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [q, ev] = await Promise.all([
        fetchJson<Quote>(`${basePath}/api/v1alpha/quotes/${encodeURIComponent(quoteName)}`),
        fetchJson<BillingEvent[]>(`${basePath}/api/v1alpha/quotes/${encodeURIComponent(quoteName)}/events`),
      ]);
      setQuote(q);
      setEvents(ev);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [basePath, quoteName]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const patch = async (updates: object) => {
    await apiCall('PATCH', `${basePath}/api/v1alpha/quotes/${encodeURIComponent(quoteName)}`, updates);
    await fetchData();
  };

  const removeManager = async (user: string) => {
    setMgrError(null);
    try {
      await apiCall('DELETE', `${basePath}/api/v1alpha/quotes/${encodeURIComponent(quoteName)}/managers/${encodeURIComponent(user)}`);
      await fetchData();
    } catch (e) {
      setMgrError(String(e));
    }
  };

  const addManager = async () => {
    const u = addMgrUser.trim();
    if (!u) return;
    setMgrError(null);
    try {
      await apiCall('POST', `${basePath}/api/v1alpha/quotes/${encodeURIComponent(quoteName)}/managers`, {
        user: u, role: addMgrRole,
      });
      setAddMgrUser('');
      await fetchData();
    } catch (e) {
      setMgrError(String(e));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center mt-24">
        <span className="text-5xl font-light text-sky-600">Loading&hellip;</span>
      </div>
    );
  }

  if (error) return <ErrorBanner message={error} />;
  if (!quote) return null;

  const canEdit = can(billingRole, 'edit_quote');
  const canManageManagers = can(billingRole, 'manage_managers');

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 mb-6 text-2xl font-light">
        <a href={`${basePath}/billing/quotes`} className="text-slate-400 hover:text-slate-600">Quotes</a>
        <span className="text-slate-300">›</span>
        <span>{quoteName}</span>
      </div>

      {/* Details */}
      <section className="border rounded mb-6">
        <SectionHeader label="Details" />
        <table className="w-full text-sm">
          <tbody>
            <EditableRow
              label="Cost Object"
              value={quote.cost_object}
              canEdit={canEdit}
              onSave={(val) => patch({ cost_object: val })}
            />
            <EditableRow
              label="Authorized Amount"
              value={quote.authorized_amount !== null ? String(quote.authorized_amount) : ''}
              displayValue={fmtDollars(quote.authorized_amount)}
              canEdit={canEdit}
              inputType="number"
              placeholder="blank = unlimited"
              onSave={(val) => patch({ authorized_amount: val === '' ? 'unlimited' : parseFloat(val) })}
            />
            <EditableRow
              label="PI Name"
              value={quote.pi_name ?? ''}
              canEdit={canEdit}
              onSave={(val) => patch({ pi_name: val })}
            />
            <EditableRow
              label="PM Designee"
              value={quote.pm_designee ?? ''}
              canEdit={canEdit}
              onSave={(val) => patch({ pm_designee: val })}
            />
          </tbody>
        </table>
      </section>

      {/* Billing Projects */}
      <section className="border rounded mb-6">
        <SectionHeader label="Billing Projects" />
        {quote.billing_projects.length > 0 ? (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left p-3 font-medium">Name</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium">Limit</th>
                  <th className="text-left p-3 font-medium">Accrued</th>
                  <th className="text-left p-3 font-medium">Remaining</th>
                  <th className="text-left p-3 font-medium">Alert</th>
                </tr>
              </thead>
              <tbody>
                {quote.billing_projects.map((bp) => {
                  const low = isLowBudget(bp);
                  return (
                    <tr key={bp.billing_project} className={`border-t hover:bg-slate-50 ${low ? 'bg-amber-50' : ''}`}>
                      <td className="p-3">
                        <a href={`${basePath}/billing_projects/${bp.billing_project}`} className="text-blue-600 hover:underline">
                          {bp.billing_project}
                        </a>
                      </td>
                      <td className="p-3 text-slate-500">{bp.status}</td>
                      <td className="p-3">{fmtDollars(bp.limit)}</td>
                      <td className="p-3">{fmtCost(bp.accrued_cost)}</td>
                      <td className={`p-3 ${low ? 'text-amber-700 font-medium' : ''}`}>{fmtDollars(bp.remaining)}</td>
                      <td className="p-3 text-slate-500">{fmtDollars(bp.low_budget_alert)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-4 text-sm text-slate-500">No billing projects under this quote.</p>
        )}
      </section>

      {/* Managers */}
      <section className="border rounded mb-6">
        <SectionHeader label="Managers" />
        <div className="p-4">
          <table className="w-full text-sm mb-3">
            <tbody>
              {quote.managers.map((m) => (
                <tr key={m.user} className="group hover:bg-slate-50">
                  <td className="py-1 pr-4">{m.user}</td>
                  <td className="py-1 pr-4 text-slate-500">{m.role}</td>
                  <td className="py-1">
                    {canManageManagers && (
                      <button
                        onClick={() => void removeManager(m.user)}
                        className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 flex items-center text-xs"
                      >
                        <span className="material-symbols-outlined text-base">close</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {mgrError && <div className="text-red-600 text-xs mb-2">{mgrError}</div>}
          {canManageManagers && (
            <div className="flex items-center gap-2">
              <input
                type="text" value={addMgrUser}
                onChange={(e) => setAddMgrUser(e.target.value)}
                placeholder="username" spellCheck={false}
                className="border rounded px-2 py-1 text-sm w-48"
                onKeyDown={(e) => { if (e.key === 'Enter') void addManager(); }}
              />
              <select
                value={addMgrRole}
                onChange={(e) => setAddMgrRole(e.target.value)}
                className="border rounded px-2 py-1 text-sm"
              >
                <option value="manager">manager</option>
                <option value="owner">owner</option>
              </select>
              <button
                onClick={() => void addManager()}
                className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
              >
                Add
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Event Log */}
      <section className="border rounded mb-6">
        <SectionHeader label="Event Log" />
        <EventLog events={events} columns={QUOTE_EVENT_COLUMNS} />
      </section>
    </div>
  );
}
