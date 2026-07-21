import { useState, useEffect, useCallback } from 'react';
import type { BillingProject, BillingEvent } from './api';
import { fetchJson, apiCall } from './api';
import { fmtDollars, fmtCost } from './fmt';
import type { BillingRole } from './permissions';
import { can } from './permissions';
import { SectionHeader, ErrorBanner, EditableRow, EventLog } from './shared';

interface Props {
  basePath: string;
  bpName: string;
  billingRole: BillingRole;
}

const BP_EVENT_COLUMNS = [
  { key: 'timestamp' as const, label: 'Time' },
  { key: 'actor' as const, label: 'Actor' },
  { key: 'action' as const, label: 'Action' },
  { key: 'target_user' as const, label: 'Target' },
  { key: 'detail' as const, label: 'Detail' },
];

export function BillingProjectPage({ basePath, bpName, billingRole }: Props) {
  const [bp, setBp] = useState<BillingProject | null>(null);
  const [events, setEvents] = useState<BillingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addUser, setAddUser] = useState('');
  const [memberError, setMemberError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [bpData, evData] = await Promise.all([
        fetchJson<BillingProject>(`${basePath}/api/v1alpha/billing_projects/${encodeURIComponent(bpName)}`),
        fetchJson<BillingEvent[]>(`${basePath}/api/v1alpha/billing_projects/${encodeURIComponent(bpName)}/events`),
      ]);
      setBp(bpData);
      setEvents(evData);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [basePath, bpName]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const patch = async (updates: object) => {
    await apiCall('PATCH', `${basePath}/api/v1alpha/billing_projects/${encodeURIComponent(bpName)}`, updates);
    await fetchData();
  };

  const handleClose = async () => {
    if (!window.confirm(`Close billing project "${bpName}"?`)) return;
    setActionError(null);
    try {
      await apiCall('POST', `${basePath}/api/v1alpha/billing_projects/${encodeURIComponent(bpName)}/close`);
      await fetchData();
    } catch (e) {
      setActionError(String(e));
    }
  };

  const handleReopen = async () => {
    if (!window.confirm(`Reopen billing project "${bpName}"?`)) return;
    setActionError(null);
    try {
      await apiCall('POST', `${basePath}/api/v1alpha/billing_projects/${encodeURIComponent(bpName)}/reopen`);
      await fetchData();
    } catch (e) {
      setActionError(String(e));
    }
  };

  const removeMember = async (user: string) => {
    setMemberError(null);
    try {
      await apiCall('POST', `${basePath}/api/v1alpha/billing_projects/${encodeURIComponent(bpName)}/users/${encodeURIComponent(user)}/remove`);
      await fetchData();
    } catch (e) {
      setMemberError(String(e));
    }
  };

  const addMember = async () => {
    const u = addUser.trim();
    if (!u) return;
    setMemberError(null);
    try {
      await apiCall('POST', `${basePath}/api/v1alpha/billing_projects/${encodeURIComponent(bpName)}/users/${encodeURIComponent(u)}/add`);
      setAddUser('');
      await fetchData();
    } catch (e) {
      setMemberError(String(e));
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
  if (!bp) return null;

  const canEditLimit = can(billingRole, 'edit_bp_limit');
  const canEditAlert = can(billingRole, 'edit_bp_alert');
  const canManageMembers = can(billingRole, 'manage_bp_members');
  const canCloseReopen = can(billingRole, 'close_reopen_bp');

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <a href={`${basePath}/billing_projects`} className="text-slate-500 hover:text-slate-700">
          <span className="material-symbols-outlined text-base">arrow_back</span>
        </a>
        <h1 className="text-2xl font-light">{bpName}</h1>
        {bp.status === 'open' ? (
          <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">open</span>
        ) : (
          <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full italic">{bp.status}</span>
        )}
      </div>

      {/* Funding */}
      <section className="border rounded mb-6">
        <SectionHeader label="Funding" />
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="py-2 pl-4 pr-8 text-slate-500 w-40 align-middle">Quote</td>
              <td className="py-2 align-middle" colSpan={2}>
                <a href={`${basePath}/billing/quotes/${bp.quote_name}`} className="text-blue-600 hover:underline">
                  {bp.quote_name}
                </a>
              </td>
            </tr>
            <EditableRow
              label="Limit"
              value={bp.limit !== null ? String(bp.limit) : ''}
              displayValue={fmtDollars(bp.limit)}
              canEdit={canEditLimit}
              inputType="number"
              placeholder="dollars (blank = unlimited)"
              onSave={(val) => patch({ limit: val === '' ? null : parseFloat(val) })}
            />
            <tr className="border-b border-slate-100">
              <td className="py-2 pl-4 pr-8 text-slate-500 w-40 align-middle">Accrued</td>
              <td className="py-2 align-middle" colSpan={2}>{fmtCost(bp.accrued_cost)}</td>
            </tr>
            <tr className="border-b border-slate-100">
              <td className="py-2 pl-4 pr-8 text-slate-500 w-40 align-middle">Remaining</td>
              <td className="py-2 align-middle" colSpan={2}>{fmtDollars(bp.remaining)}</td>
            </tr>
            <EditableRow
              label="Alert threshold"
              value={bp.low_budget_alert !== null ? String(bp.low_budget_alert) : ''}
              displayValue={fmtDollars(bp.low_budget_alert)}
              canEdit={canEditAlert}
              inputType="number"
              placeholder="dollars (blank = none)"
              onSave={(val) => patch({ low_budget_alert: val === '' ? null : parseFloat(val) })}
            />
          </tbody>
        </table>
        {actionError && <div className="px-4 pb-3 text-red-600 text-xs">{actionError}</div>}
        {canCloseReopen && (
          <div className="px-4 pb-4 flex gap-2">
            {bp.status === 'open' ? (
              <button
                onClick={() => void handleClose()}
                className="bg-red-600 text-white px-3 py-1.5 rounded text-sm hover:bg-red-700"
              >
                Close
              </button>
            ) : (
              <button
                onClick={() => void handleReopen()}
                className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700"
              >
                Reopen
              </button>
            )}
          </div>
        )}
      </section>

      {/* Members */}
      <section className="border rounded mb-6">
        <SectionHeader label="Members" />
        <div className="p-4">
          <table className="w-full text-sm">
            <tbody>
              {(bp.users ?? []).map((user) => (
                <tr key={user} className="group hover:bg-slate-50">
                  <td className="py-1 pr-4">{user}</td>
                  <td className="py-1">
                    {canManageMembers && (
                      <button
                        onClick={() => void removeMember(user)}
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
          {memberError && <div className="text-red-600 text-xs mt-1">{memberError}</div>}
          {canManageMembers && (
            <div className="mt-3 flex items-center gap-2">
              <input
                type="text"
                value={addUser}
                onChange={(e) => setAddUser(e.target.value)}
                placeholder="username"
                spellCheck={false}
                className="border rounded px-2 py-1 text-sm w-48"
                onKeyDown={(e) => { if (e.key === 'Enter') void addMember(); }}
              />
              <button
                onClick={() => void addMember()}
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
        <EventLog events={events} columns={BP_EVENT_COLUMNS} />
      </section>
    </div>
  );
}
