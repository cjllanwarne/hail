import { useState } from 'react';
import {
  DriverInfo,
  DriverInstance,
  FeatureFlags,
  InstCollSummary,
  InstCollStatsByState,
  SystemPermissions,
  driverPost,
  gcpLogsUrl,
  naturalDelta,
  usePolling,
} from './shared';
import { AutoRefresher } from '../shared/AutoRefresher';

const STATES = ['pending', 'active', 'inactive', 'deleted'] as const;

function cores(mcpu: number): string {
  return ((mcpu ?? 0) / 1000).toFixed(2);
}

const EMPTY = <span className="text-zinc-300">--</span>;

function pct(num: number, denom: number): JSX.Element | string {
  if (!denom) return EMPTY;
  return `${(((num ?? 0) * 100) / denom).toFixed(1)}%`;
}

function StatesByState({ counts, unit = 'instances' }: { counts: InstCollStatsByState; unit?: string }) {
  return (
    <>
      {STATES.map((s) => (
        <td key={s} className="px-2 font-light whitespace-nowrap text-right">
          {unit === 'cores' ? cores(counts[s] ?? 0) : (counts[s] ?? 0)}
        </td>
      ))}
    </>
  );
}

function InstCollRow({ ic, basePath, isPool }: { ic: InstCollSummary; basePath: string; isPool: boolean }) {
  const href = isPool ? `${basePath}/inst_coll/pool/${ic.name}` : `${basePath}/inst_coll/jpim`;
  const td = 'px-2 font-light whitespace-nowrap';
  const num = `${td} text-right`;
  return (
    <tr className="border border-collapse hover:bg-slate-100">
      <td className={td}>
        <a href={href} className="text-sky-600 hover:underline">{ic.name}</a>
      </td>
      <StatesByState counts={ic.all_versions_instances_by_state} />
      <td className={num}>{ic.max_live_instances}</td>
      <td className={num}>{ic.max_instances}</td>
      <td className={num}>{pct((ic.all_versions_instances_by_state.pending ?? 0) + (ic.all_versions_instances_by_state.active ?? 0), ic.max_live_instances)}</td>
      <td className="px-1" />
      <StatesByState counts={ic.all_versions_cores_mcpu_by_state} unit="cores" />
      <td className="px-1" />
      {isPool ? (
        <>
          <td className={num}>{cores(ic.schedulable_free_cores_mcpu)}</td>
          <td className={num}>{cores(ic.schedulable_cores_mcpu)}</td>
          <td className={num}>{pct(ic.schedulable_free_cores_mcpu, ic.schedulable_cores_mcpu)}</td>
        </>
      ) : (
        <>
          <td className={num}>{EMPTY}</td>
          <td className={num}>{EMPTY}</td>
          <td className={num}>{EMPTY}</td>
        </>
      )}
    </tr>
  );
}

function InstanceCollectionsTable({
  pools,
  jpim,
  globalStats,
  basePath,
}: {
  pools: InstCollSummary[];
  jpim: InstCollSummary;
  globalStats: DriverInfo['global_stats'];
  basePath: string;
}) {
  const thClass = 'h-10 bg-slate-200 font-light text-md text-center px-2 whitespace-nowrap';

  return (
    <div className="overflow-x-auto">
      <table className="table-auto">
        <thead>
          <tr>
            <th rowSpan={2} className={thClass}>Name</th>
            <th colSpan={7} className={thClass}>Instances</th>
            <th rowSpan={2} className="bg-slate-200 px-2" />
            <th colSpan={4} className={thClass}>Cores</th>
            <th rowSpan={2} className="bg-slate-200 px-2" />
            <th colSpan={3} className={thClass}>Schedulable Cores</th>
          </tr>
          <tr>
            {(['Pending', 'Active', 'Inactive', 'Deleted'] as const).map((s) => (
              <th key={s} className={thClass}>{s}</th>
            ))}
            <th className={thClass}>Max Live</th>
            <th className={thClass}>Max</th>
            <th className={thClass}>% of Max</th>
            {(['Pending', 'Active', 'Inactive', 'Deleted'] as const).map((s) => (
              <th key={s} className={thClass}>{s}</th>
            ))}
            <th className={thClass}>Free</th>
            <th className={thClass}>Total</th>
            <th className={thClass}>% Free</th>
          </tr>
        </thead>
        <tbody className="border border-collapse border-slate-50">
          {pools.map((p) => (
            <InstCollRow key={p.name} ic={p} basePath={basePath} isPool />
          ))}
          <InstCollRow ic={jpim} basePath={basePath} isPool={false} />
        </tbody>
        <tfoot>
          <tr className="bg-slate-200 font-light">
            <td className="px-2 whitespace-nowrap">Total</td>
            <StatesByState counts={globalStats.n_instances_by_state} />
            <td className="px-2 text-right">{EMPTY}</td>
            <td className="px-2 text-right">{EMPTY}</td>
            <td className="px-2 text-right">{EMPTY}</td>
            <td className="px-1" />
            <StatesByState counts={globalStats.cores_mcpu_by_state} unit="cores" />
            <td className="px-1" />
            <td className="px-2 whitespace-nowrap text-right">{cores(globalStats.schedulable_free_cores_mcpu)}</td>
            <td className="px-2 whitespace-nowrap text-right">{cores(globalStats.schedulable_cores_mcpu)}</td>
            <td className="px-2 whitespace-nowrap text-right">{pct(globalStats.schedulable_free_cores_mcpu, globalStats.schedulable_cores_mcpu)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function InstanceRow({ instance }: { instance: DriverInstance }) {
  const now = Date.now();
  const td = 'px-2 font-light whitespace-nowrap';
  const num = `${td} text-right`;
  return (
    <tr className="border border-collapse hover:bg-slate-100">
      <td className={`${td} font-mono text-sm`}>{instance.name}</td>
      <td className={td}>{instance.inst_coll_name}</td>
      <td className={td}>{instance.location}</td>
      <td className={num}>{instance.version}</td>
      <td className={td}>{instance.state}</td>
      <td className={num}>{cores(instance.free_cores_mcpu)} / {cores(instance.cores_mcpu)}</td>
      <td className={num}>{instance.failed_request_count}</td>
      <td className={td}>{new Date(instance.time_created_ms).toLocaleString()}</td>
      <td className={td}>{naturalDelta(now - instance.last_updated_ms)} ago</td>
      <td className={td}>
        <a href={gcpLogsUrl(instance.name)} target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline">
          Logs
        </a>
      </td>
    </tr>
  );
}

function InstancesTable({ instances }: { instances: DriverInstance[] }) {
  const thClass = 'h-10 bg-slate-200 font-light text-md text-center px-2 whitespace-nowrap';

  return (
    <div className="overflow-x-auto">
      <table className="table-auto">
        <thead>
          <tr>
            {['Name', 'Instance Collection', 'Location', 'Version', 'State', 'Free Cores', 'Failed Requests', 'Time Created', 'Last Updated', 'Logs'].map(
              (h) => <th key={h} className={thClass}>{h}</th>,
            )}
          </tr>
        </thead>
        <tbody className="border border-collapse border-slate-50">
          {instances.map((i) => (
            <InstanceRow key={i.name} instance={i} />
          ))}
          {instances.length === 0 && (
            <tr>
              <td colSpan={10} className="px-2 py-4 text-center font-light text-zinc-400">No instances</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const FLAG_LABELS: Record<string, string> = {
  compact_billing_tables: 'compact_billing_tables',
  oms_agent: 'oms_agent',
  dockerhub_proxy: 'dockerhub_proxy',
};

function FeatureFlagsPanel({
  flags,
  canUpdate,
  basePath,
  csrfToken,
  onUpdated,
}: {
  flags: FeatureFlags;
  canUpdate: boolean;
  basePath: string;
  csrfToken: string;
  onUpdated: (flags: FeatureFlags) => void;
}) {
  const [draft, setDraft] = useState<FeatureFlags>({ ...flags });
  const [pending, setPending] = useState(false);
  const isDirty = Object.keys(FLAG_LABELS).some((k) => draft[k] !== flags[k]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canUpdate || pending) return;
    setPending(true);
    try {
      const resp = await driverPost(`${basePath}/api/v1alpha/configure-feature-flags`, csrfToken, draft);
      if (resp.ok) {
        const data = (await resp.json()) as { feature_flags: FeatureFlags };
        onUpdated(data.feature_flags);
        setDraft({ ...data.feature_flags });
      }
    } finally {
      setPending(false);
    }
  };

  if (!canUpdate) {
    return (
      <div className="ml-4">
        {Object.entries(FLAG_LABELS).map(([key, label]) => (
          <span key={key} className="mr-4">{label}: {String(flags[key] ?? false)}</span>
        ))}
      </div>
    );
  }

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }}>
      {Object.entries(FLAG_LABELS).map(([key, label]) => (
        <label key={key} className="mr-4">
          <input
            type="checkbox"
            name={key}
            checked={draft[key] ?? false}
            onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.checked }))}
            disabled={pending}
          />
          {' '}{label}
        </label>
      ))}
      <button
        type="submit"
        disabled={pending || !isDirty}
        title={isDirty ? undefined : 'No changes to apply'}
        className="border border-gray-200 bg-gray-50 hover:bg-slate-400 hover:text-white px-2 py-1 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Update
      </button>
    </form>
  );
}

const REFRESH_INTERVAL_MS = 30_000;

interface Props {
  basePath: string;
  csrfToken: string;
  permissions: SystemPermissions;
}

export function IndexPage({ basePath, csrfToken, permissions }: Props): JSX.Element {
  const canUpdate = permissions['update_deployed_system_state'] === true;

  const [autoRefresh, setAutoRefreshState] = useState<boolean>(() => {
    try { return localStorage.getItem('batch.driverPage.autoRefresh') !== 'false'; } catch { return true; }
  });
  const setAutoRefresh = (v: boolean) => {
    setAutoRefreshState(v);
    try { localStorage.setItem('batch.driverPage.autoRefresh', String(v)); } catch { /* ignore */ }
  };

  const { data, error, loading, refreshing, countdownKey, refresh } = usePolling<DriverInfo>(
    `${basePath}/api/v1alpha/driver_info`,
    autoRefresh ? REFRESH_INTERVAL_MS : null,
  );

  const [localFlags, setLocalFlags] = useState<FeatureFlags | null>(null);
  const flags = localFlags ?? data?.feature_flags ?? null;

  const [actionPending, setActionPending] = useState(false);

  const handleFreeze = async () => {
    if (actionPending) return;
    setActionPending(true);
    try {
      await driverPost(`${basePath}/api/v1alpha/freeze`, csrfToken);
      refresh();
    } finally {
      setActionPending(false);
    }
  };

  const handleUnfreeze = async () => {
    if (actionPending) return;
    setActionPending(true);
    try {
      await driverPost(`${basePath}/api/v1alpha/unfreeze`, csrfToken);
      refresh();
    } finally {
      setActionPending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center mt-24">
        <span className="text-3xl font-light text-sky-600">Loading…</span>
      </div>
    );
  }

  if (!data) {
    return <div className="mt-8 font-light text-red-600">Error loading driver info: {error ?? 'unknown error'}</div>;
  }

  const frozen = Boolean(data.frozen);

  return (
    <div className="flex-col m-auto w-full space-y-4">
      <div className="mb-4">
        <div>
          <button
            onClick={() => { document.cookie = 'hail_react_ui=; max-age=0; path=/; SameSite=Lax'; location.reload(); }}
            className="text-sky-600 hover:underline"
            style={{ fontSize: '0.85em' }}
          >
            Back to classic layout
          </button>
        </div>
        <div style={{ width: '33%' }}>
          <AutoRefresher
            autoRefresh={autoRefresh}
            onToggle={setAutoRefresh}
            refreshing={refreshing}
            countdownKey={countdownKey}
            intervalMs={REFRESH_INTERVAL_MS}
            trackColor="#cbd5e1"
          />
          {error && (
            <div className="mt-1 text-xs text-red-500">Refresh failed: {error}</div>
          )}
        </div>
      </div>

      <section>
        <h1 className="text-2xl font-light">Globals</h1>
        <div className="ml-4">
          <div>instance ID: {data.instance_id}</div>
          <div>ready cores: {cores(data.ready_cores_mcpu)}</div>
          <div>frozen: {String(frozen)}</div>
        </div>
        {canUpdate && (
          <div>
            {frozen ? (
              <form onSubmit={(e) => { e.preventDefault(); void handleUnfreeze(); }}>
                <button
                  type="submit"
                  disabled={actionPending}
                  className="border border-gray-200 bg-gray-50 hover:bg-slate-400 hover:text-white px-2 py-1 rounded-md"
                >
                  Unfreeze
                </button>
              </form>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); void handleFreeze(); }}>
                <button
                  type="submit"
                  disabled={actionPending}
                  className="border border-gray-200 bg-gray-50 hover:bg-red-700 text-red-500 hover:text-white px-2 py-1 rounded-md"
                >
                  Freeze
                </button>
              </form>
            )}
          </div>
        )}
      </section>

      <section>
        <h1 className="text-2xl font-light">Feature Flags</h1>
        {flags && (
          <FeatureFlagsPanel
            flags={flags}
            canUpdate={canUpdate}
            basePath={basePath}
            csrfToken={csrfToken}
            onUpdated={setLocalFlags}
          />
        )}
      </section>

      <section>
        <h1 className="text-2xl font-light">Instance Collections</h1>
        <InstanceCollectionsTable
          pools={data.pools}
          jpim={data.jpim}
          globalStats={data.global_stats}
          basePath={basePath}
        />
      </section>

      <section>
        <h1 className="text-2xl font-light">Instances</h1>
        <InstancesTable instances={data.instances} />
      </section>
    </div>
  );
}
