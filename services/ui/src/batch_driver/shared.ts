import { useState, useEffect, useCallback } from 'react';

export type SystemPermissions = Record<string, boolean>;

export function getSystemPermissions(): SystemPermissions {
  const content = document.querySelector('meta[name="system-permissions"]')?.getAttribute('content');
  return content ? (JSON.parse(content) as SystemPermissions) : {};
}

export interface InstCollStatsByState {
  pending: number;
  active: number;
  inactive: number;
  deleted: number;
}

export interface InstCollSummary {
  name: string;
  all_versions_instances_by_state: InstCollStatsByState;
  all_versions_cores_mcpu_by_state: InstCollStatsByState;
  schedulable_free_cores_mcpu: number;
  schedulable_cores_mcpu: number;
  max_live_instances: number;
  max_instances: number;
}

export interface GlobalStats {
  n_instances_by_state: InstCollStatsByState;
  cores_mcpu_by_state: InstCollStatsByState;
  schedulable_free_cores_mcpu: number;
  schedulable_cores_mcpu: number;
}

export interface FeatureFlags {
  compact_billing_tables: boolean;
  oms_agent: boolean;
  dockerhub_proxy: boolean;
  [key: string]: boolean;
}

export interface DriverInstance {
  name: string;
  inst_coll_name: string;
  location: string;
  version: number;
  state: 'pending' | 'active' | 'inactive' | 'deleted';
  free_cores_mcpu: number;
  cores_mcpu: number;
  failed_request_count: number;
  time_created_ms: number;
  last_updated_ms: number;
}

export interface DriverInfo {
  instance_id: string;
  frozen: boolean;
  ready_cores_mcpu: number;
  feature_flags: FeatureFlags;
  pools: InstCollSummary[];
  jpim: InstCollSummary;
  global_stats: GlobalStats;
  instances: DriverInstance[];
}

export function usePolling<T>(url: string, intervalMs: number | null): {
  data: T | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  countdownKey: number;
  refresh: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [countdownKey, setCountdownKey] = useState(0);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const resp = await fetch(url, { credentials: 'same-origin' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setData(await resp.json() as T);
      setError(null);
      setCountdownKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (isRefresh) setCountdownKey((k) => k + 1);
    } finally {
      setLoading(false);
      if (isRefresh) setRefreshing(false);
    }
  }, [url]);

  useEffect(() => {
    void fetchData(false);
  }, [fetchData]);

  useEffect(() => {
    if (intervalMs === null) return;
    const id = setInterval(() => { void fetchData(true); }, intervalMs);
    return () => clearInterval(id);
  }, [fetchData, intervalMs]);

  return { data, error, loading, refreshing, countdownKey, refresh: () => { void fetchData(true); } };
}

export async function driverPost(url: string, csrfToken: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'X-CSRF-Token': csrfToken,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

export function naturalDelta(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function gcpLogsUrl(instanceName: string): string {
  const query = encodeURIComponent(
    `"${instanceName}"\n-protoPayload.serviceName="logging.googleapis.com"\n-protoPayload.serviceName="securitycenter.googleapis.com"`,
  );
  return `https://console.cloud.google.com/logs/query;query=${query}`;
}
