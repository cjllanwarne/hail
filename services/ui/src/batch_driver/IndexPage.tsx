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

const STATES = ['pending', 'active', 'inactive', 'deleted'] as const;

function cores(mcpu: number): string {
  return (mcpu / 1000).toString();
}

function pct(num: number, denom: number): string {
  if (denom === 0) return '';
  return `${((num * 100) / denom).toFixed(1)}%`;
}

function StatesByState({ counts, unit = 'instances' }: { counts: InstCollStatsByState; unit?: string }) {
  return (
    <>
      {STATES.map((s) => (
        <td key={s} className="px-3 py-2 text-right tabular-nums">
          {unit === 'cores' ? cores(counts[s]) : counts[s]}
        </td>
      ))}
    </>
  );
}

function InstCollRow({ ic, basePath, isPool }: { ic: InstCollSummary; basePath: string; isPool: boolean }) {
  const href = isPool ? `${basePath}/inst_coll/pool/${ic.name}` : `${basePath}/inst_coll/jpim`;
  return (
    <tr className="border-b hover:bg-zinc-50">
      <td className="px-3 py-2">
        <a href={href} className="text-sky-600 hover:underline">{ic.name}</a>
      </td>
      <StatesByState counts={ic.all_versions_instances_by_state} />
      <td className="px-3 py-2" />
      <StatesByState counts={ic.all_versions_cores_mcpu_by_state} unit="cores" />
      <td className="px-3 py-2" />
      {isPool ? (
        <>
          <td className="px-3 py-2 text-right tabular-nums">{cores(ic.schedulable_free_cores_mcpu)}</td>
          <td className="px-3 py-2 text-right tabular-nums">{cores(ic.schedulable_cores_mcpu)}</td>
          <td className="px-3 py-2 text-right tabular-nums text-zinc-400">
            {pct(ic.schedulable_free_cores_mcpu, ic.schedulable_cores_mcpu)}
          </td>
        </>
      ) : (
        <td colSpan={3} className="px-3 py-2" />
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
  const thClass = 'px-3 py-2 text-left font-medium text-zinc-500 text-xs uppercase tracking-wide';
  const thNumClass = `${thClass} text-right`;

  return (
    <div className="overflow-x-auto rounded border border-zinc-200">
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-50 border-b border-zinc-200">
          <tr>
            <th rowSpan={2} className={thClass}>Name</th>
            <th colSpan={4} className={`${thClass} border-l border-zinc-200`}>Instances</th>
            <th rowSpan={2} className="px-2" />
            <th colSpan={4} className={`${thClass} border-l border-zinc-200`}>Cores</th>
            <th rowSpan={2} className="px-2" />
            <th colSpan={3} className={`${thClass} border-l border-zinc-200`}>Schedulable Cores</th>
          </tr>
          <tr>
            {(['Pending', 'Active', 'Inactive', 'Deleted'] as const).map((s) => (
              <th key={s} className={thNumClass}>{s}</th>
            ))}
            {(['Pending', 'Active', 'Inactive', 'Deleted'] as const).map((s) => (
              <th key={s} className={thNumClass}>{s}</th>
            ))}
            <th className={thNumClass}>Free</th>
            <th className={thNumClass}>Total</th>
            <th className={thNumClass}>% Free</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {pools.map((p) => (
            <InstCollRow key={p.name} ic={p} basePath={basePath} isPool />
          ))}
          <InstCollRow ic={jpim} basePath={basePath} isPool={false} />
        </tbody>
        <tfoot className="bg-zinc-50 border-t border-zinc-200 font-medium">
          <tr>
            <td className="px-3 py-2">Total</td>
            <StatesByState counts={globalStats.n_instances_by_state} />
            <td className="px-3 py-2" />
            <StatesByState counts={globalStats.cores_mcpu_by_state} unit="cores" />
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-right tabular-nums">{cores(globalStats.schedulable_free_cores_mcpu)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{cores(globalStats.schedulable_cores_mcpu)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-zinc-400">
              {pct(globalStats.schedulable_free_cores_mcpu, globalStats.schedulable_cores_mcpu)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function InstanceRow({ instance }: { instance: DriverInstance }) {
  const now = Date.now();
  const stateColors: Record<string, string> = {
    active: 'text-emerald-700 bg-emerald-50',
    pending: 'text-amber-700 bg-amber-50',
    inactive: 'text-zinc-500 bg-zinc-100',
    deleted: 'text-red-600 bg-red-50',
  };
  const badge = stateColors[instance.state] ?? 'text-zinc-600 bg-zinc-100';

  return (
    <tr className="border-b hover:bg-zinc-50 text-sm">
      <td className="px-3 py-2 font-mono text-xs">{instance.name}</td>
      <td className="px-3 py-2">{instance.inst_coll_name}</td>
      <td className="px-3 py-2">{instance.location}</td>
      <td className="px-3 py-2 text-right tabular-nums">{instance.version}</td>
      <td className="px-3 py-2">
        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${badge}`}>{instance.state}</span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {cores(instance.free_cores_mcpu)} / {cores(instance.cores_mcpu)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{instance.failed_request_count}</td>
      <td className="px-3 py-2 tabular-nums text-zinc-500 text-xs">
        {new Date(instance.time_created_ms).toLocaleString()}
      </td>
      <td className="px-3 py-2 tabular-nums text-zinc-500 text-xs">
        {naturalDelta(now - instance.last_updated_ms)} ago
      </td>
      <td className="px-3 py-2">
        <a
          href={gcpLogsUrl(instance.name)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-600 hover:underline text-xs"
        >
          Logs ↗
        </a>
      </td>
    </tr>
  );
}

function InstancesTable({ instances }: { instances: DriverInstance[] }) {
  const thClass = 'px-3 py-2 text-left font-medium text-zinc-500 text-xs uppercase tracking-wide';

  return (
    <div className="overflow-x-auto rounded border border-zinc-200">
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-50 border-b border-zinc-200">
          <tr>
            {['Name', 'Collection', 'Location', 'Ver', 'State', 'Free Cores', 'Failed Req', 'Created', 'Updated', ''].map(
              (h) => (
                <th key={h} className={thClass}>{h}</th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {instances.map((i) => (
            <InstanceRow key={i.name} instance={i} />
          ))}
          {instances.length === 0 && (
            <tr>
              <td colSpan={10} className="px-3 py-6 text-center text-zinc-400">No instances</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

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
  const [pending, setPending] = useState(false);
  const FLAG_LABELS: Record<string, string> = {
    compact_billing_tables: 'compact_billing_tables',
    oms_agent: 'oms_agent',
    dockerhub_proxy: 'dockerhub_proxy',
  };

  const toggle = async (key: string) => {
    if (!canUpdate || pending) return;
    const next = { ...flags, [key]: !flags[key] };
    setPending(true);
    try {
      const resp = await driverPost(`${basePath}/api/v1alpha/configure-feature-flags`, csrfToken, next);
      if (resp.ok) {
        const data = (await resp.json()) as { feature_flags: FeatureFlags };
        onUpdated(data.feature_flags);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-4">
      {Object.entries(FLAG_LABELS).map(([key, label]) => (
        <label
          key={key}
          className={`flex items-center gap-2 text-sm ${canUpdate ? 'cursor-pointer' : 'cursor-default'}`}
        >
          <input
            type="checkbox"
            checked={flags[key] ?? false}
            onChange={() => { void toggle(key); }}
            disabled={!canUpdate || pending}
            className="h-4 w-4 rounded text-sky-600"
          />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

interface Props {
  basePath: string;
  csrfToken: string;
  permissions: SystemPermissions;
}

export function IndexPage({ basePath, csrfToken, permissions }: Props): JSX.Element {
  const canUpdate = permissions['update_deployed_system_state'] === true;
  const { data, error, loading, refresh } = usePolling<DriverInfo>(`${basePath}/api/v1alpha/driver_info`);

  // feature flags can be optimistically updated
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
        <span className="text-5xl font-light text-sky-600">Loading…</span>
      </div>
    );
  }

  if (error || !data) {
    return <div className="mt-8 text-red-600">Error loading driver info: {error ?? 'unknown error'}</div>;
  }

  const frozen = data.frozen;

  return (
    <div className="pb-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-light text-zinc-800">Batch Driver</h1>
        <button
          onClick={() => { document.cookie = 'hail_react_ui=; max-age=0; path=/; SameSite=Lax'; location.reload(); }}
          className="text-sm text-sky-600 hover:underline"
        >
          Back to classic layout
        </button>
      </div>

      {/* Frozen banner */}
      {frozen && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-center gap-3">
          <span className="text-red-600 font-semibold">⚠ Batch is frozen</span>
          <span className="text-red-500 text-sm">All instance collections and batch submissions are paused.</span>
        </div>
      )}

      {/* Globals */}
      <section>
        <h2 className="text-lg font-medium text-zinc-700 mb-3">Globals</h2>
        <div className="flex flex-wrap gap-6 text-sm">
          <div>
            <span className="text-zinc-500">Instance ID</span>
            <p className="font-mono mt-0.5">{data.instance_id}</p>
          </div>
          <div>
            <span className="text-zinc-500">Ready Cores</span>
            <p className="font-semibold mt-0.5">{cores(data.ready_cores_mcpu)}</p>
          </div>
          <div>
            <span className="text-zinc-500">Status</span>
            <p className="mt-0.5">
              {frozen ? (
                <span className="text-red-600 font-semibold">Frozen</span>
              ) : (
                <span className="text-emerald-700 font-semibold">Running</span>
              )}
            </p>
          </div>
          {canUpdate && (
            <div className="flex items-end">
              {frozen ? (
                <button
                  onClick={() => { void handleUnfreeze(); }}
                  disabled={actionPending}
                  className="px-4 py-1.5 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                >
                  Unfreeze
                </button>
              ) : (
                <button
                  onClick={() => { void handleFreeze(); }}
                  disabled={actionPending}
                  className="px-4 py-1.5 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  Freeze
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Feature Flags */}
      <section>
        <h2 className="text-lg font-medium text-zinc-700 mb-3">Feature Flags</h2>
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

      {/* Instance Collections */}
      <section>
        <h2 className="text-lg font-medium text-zinc-700 mb-3">Instance Collections</h2>
        <InstanceCollectionsTable
          pools={data.pools}
          jpim={data.jpim}
          globalStats={data.global_stats}
          basePath={basePath}
        />
      </section>

      {/* Instances */}
      <section>
        <h2 className="text-lg font-medium text-zinc-700 mb-3">
          Instances <span className="text-zinc-400 text-base font-normal">({data.instances.length})</span>
        </h2>
        <InstancesTable instances={data.instances} />
      </section>
    </div>
  );
}
