import { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

// --- Types ---

interface CloudCosts {
  production_compute: number;
  k8s: number;
  batch_test: number;
  batch_dev: number;
  other_services: number;
  unknown_compute: number;
  total: number;
}

interface BillingRow {
  billing_project: string;
  user: string;
  resource: string;
  cost: number;
}

interface UserBilling {
  total: number;
  resource_cost: number;
  service_fee_cost: number;
  by_project: { billing_project: string; cost: number }[];
}

// --- Helpers ---

function currentMonthParam(): string {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

function monthParamToInputValue(param: string): string {
  const [mm, yyyy] = param.split('/');
  return `${yyyy}-${mm}`;
}

function inputValueToMonthParam(value: string): string {
  const [yyyy, mm] = value.split('-');
  return `${mm}/${yyyy}`;
}

function monthToDateRange(param: string): { start: string; end: string } {
  const [mm, yyyy] = param.split('/');
  const lastDay = new Date(parseInt(yyyy), parseInt(mm), 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { start: `${mm}/01/${yyyy}`, end: `${mm}/${pad(lastDay)}/${yyyy}` };
}

function parseCostStr(s: string): number {
  if (!s || s.startsWith('<')) return 0;
  return parseFloat(s.replace(/[$,]/g, '')) || 0;
}

function fmt(dollars: number): string {
  return dollars.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return '—';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

// --- API fetchers ---

async function fetchCloudCosts(monitoringBaseUrl: string, period: string): Promise<CloudCosts> {
  const resp = await fetch(`${monitoringBaseUrl}/api/v1alpha/billing?time_period=${encodeURIComponent(period)}`);
  if (!resp.ok) throw new Error(`Cloud billing fetch failed (HTTP ${resp.status})`);
  const data = await resp.json();

  const breakdown: { source: string; cost: string }[] = data['compute_cost_breakdown'] ?? [];
  const byService: { service: string; cost: string }[] = data['cost_by_service'] ?? [];

  const costs: CloudCosts = { production_compute: 0, k8s: 0, batch_test: 0, batch_dev: 0, other_services: 0, unknown_compute: 0, total: 0 };
  let computeTotal = 0;
  for (const row of breakdown) {
    const cost = parseCostStr(row.cost);
    computeTotal += cost;
    if (row.source === 'batch-production') costs.production_compute += cost;
    else if (row.source === 'k8s') costs.k8s += cost;
    else if (row.source === 'batch-test') costs.batch_test += cost;
    else if (row.source === 'batch-dev') costs.batch_dev += cost;
    else if (row.source === 'unknown') costs.unknown_compute += cost;
  }
  const cloudTotal = byService.reduce((sum, row) => sum + parseCostStr(row.cost), 0);
  costs.other_services = Math.max(0, cloudTotal - computeTotal);
  costs.total = cloudTotal;
  return costs;
}

async function fetchUserBilling(batchBaseUrl: string, period: string): Promise<UserBilling> {
  const { start, end } = monthToDateRange(period);
  const url = `${batchBaseUrl}/api/v1alpha/billing_breakdown?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`User billing fetch failed (HTTP ${resp.status})`);
  const rows: BillingRow[] = await resp.json();

  const projectTotals: Record<string, number> = {};
  let total = 0;
  let service_fee_cost = 0;
  for (const row of rows) {
    total += row.cost;
    projectTotals[row.billing_project] = (projectTotals[row.billing_project] ?? 0) + row.cost;
    if (row.resource === 'service-fee') service_fee_cost += row.cost;
  }
  const by_project = Object.entries(projectTotals)
    .map(([billing_project, cost]) => ({ billing_project, cost }))
    .sort((a, b) => b.cost - a.cost);
  return { total, resource_cost: total - service_fee_cost, service_fee_cost, by_project };
}

// --- Components ---

interface PanelProps { title: string; subtitle?: string; children: React.ReactNode }
function Panel({ title, subtitle, children }: PanelProps) {
  return (
    <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-200 bg-zinc-50">
        <h2 className="text-base font-semibold text-zinc-800">{title}</h2>
        {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="px-5 py-3">{children}</div>
    </div>
  );
}

interface CostRowProps { label: string; value: number; indent?: boolean; bold?: boolean; colorClass?: string }
function CostRow({ label, value, indent = false, bold = false, colorClass }: CostRowProps) {
  return (
    <div className={`flex justify-between py-2 border-b border-zinc-100 last:border-0 ${indent ? 'pl-6' : ''}`}>
      <span className={`text-zinc-700 ${bold ? 'font-semibold' : ''}`}>{label}</span>
      <span className={`tabular-nums ${bold ? 'font-semibold' : ''} ${colorClass ?? ''}`}>{fmt(value)}</span>
    </div>
  );
}

function RatioRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-zinc-100 last:border-0">
      <span className="text-zinc-700">{label}</span>
      <span className="tabular-nums text-zinc-600">{value}</span>
    </div>
  );
}

// --- Main component ---

interface CostAnalysisProps { monitoringBaseUrl: string; batchBaseUrl: string }

function CostAnalysis({ monitoringBaseUrl, batchBaseUrl }: CostAnalysisProps) {
  const [timePeriod, setTimePeriod] = useState(currentMonthParam());
  const [cloudCosts, setCloudCosts] = useState<CloudCosts | null>(null);
  const [userBilling, setUserBilling] = useState<UserBilling | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async (period: string) => {
    setLoading(true);
    setCloudCosts(null);
    setUserBilling(null);
    setCloudError(null);
    setBillingError(null);

    const [cloudResult, billingResult] = await Promise.allSettled([
      fetchCloudCosts(monitoringBaseUrl, period),
      fetchUserBilling(batchBaseUrl, period),
    ]);

    if (cloudResult.status === 'fulfilled') setCloudCosts(cloudResult.value);
    else setCloudError(cloudResult.reason instanceof Error ? cloudResult.reason.message : 'Failed to load cloud costs.');

    if (billingResult.status === 'fulfilled') setUserBilling(billingResult.value);
    else setBillingError(billingResult.reason instanceof Error ? billingResult.reason.message : 'Failed to load user billing.');

    setLoading(false);
  }, [monitoringBaseUrl, batchBaseUrl]);

  useEffect(() => { fetchData(timePeriod); }, [fetchData, timePeriod]);

  const systemOverhead = cloudCosts
    ? cloudCosts.k8s + cloudCosts.batch_test + cloudCosts.batch_dev + cloudCosts.other_services + cloudCosts.unknown_compute
    : 0;
  const net = userBilling && cloudCosts ? userBilling.total - cloudCosts.total : null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-light text-zinc-800">Cost Analysis</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm text-zinc-500">Month</label>
          <input
            type="month"
            className="border border-zinc-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            value={monthParamToInputValue(timePeriod)}
            onChange={e => { if (e.target.value) setTimePeriod(inputValueToMonthParam(e.target.value)); }}
          />
          {loading && <span className="text-xs text-zinc-400 animate-pulse">Loading…</span>}
        </div>
      </div>

      <Panel title="Cloud Costs" subtitle="What GCP invoiced us — Compute Engine by source, plus other services">
        {cloudError ? (
          <p className="text-red-500 text-sm py-2">{cloudError}</p>
        ) : cloudCosts ? (
          <>
            <CostRow label="User-driven compute (batch-production)" value={cloudCosts.production_compute} />
            <div className="mt-1 mb-1">
              <div className="text-xs font-medium text-zinc-400 uppercase tracking-wide py-1">System overhead</div>
              <CostRow label="K8s nodes" value={cloudCosts.k8s} indent />
              <CostRow label="Batch test VMs" value={cloudCosts.batch_test} indent />
              <CostRow label="Batch dev VMs" value={cloudCosts.batch_dev} indent />
              <CostRow label="Other services (SQL, networking, storage…)" value={cloudCosts.other_services} indent />
              {cloudCosts.unknown_compute > 0 && <CostRow label="Unknown compute" value={cloudCosts.unknown_compute} indent />}
              <CostRow label="Overhead subtotal" value={systemOverhead} indent bold />
            </div>
            <CostRow label="Total cloud cost" value={cloudCosts.total} bold />
          </>
        ) : !loading && <p className="text-zinc-400 text-sm py-2">No data for {timePeriod}.</p>}
      </Panel>

      <Panel title="User Billing" subtitle="What we charged users across all billing projects">
        {billingError ? (
          <p className="text-amber-600 text-sm py-2">{billingError}</p>
        ) : userBilling ? (
          <>
            <CostRow label="Resource usage" value={userBilling.resource_cost} indent />
            <CostRow label="Service fees" value={userBilling.service_fee_cost} indent />
            <CostRow label="Total billed to users" value={userBilling.total} bold />
            {userBilling.by_project.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-medium text-zinc-400 uppercase tracking-wide pb-1">By billing project</div>
                <div className="max-h-48 overflow-y-auto">
                  {userBilling.by_project.map(({ billing_project, cost }) => (
                    <div key={billing_project} className="flex justify-between py-1.5 border-b border-zinc-100 last:border-0 text-sm">
                      <span className="text-zinc-600 truncate pr-4">{billing_project}</span>
                      <span className="tabular-nums text-zinc-700 shrink-0">{fmt(cost)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : !loading && <p className="text-zinc-400 text-sm py-2">No data for {timePeriod}.</p>}
      </Panel>

      {net !== null && cloudCosts && userBilling && (
        <Panel title="Margin Analysis">
          <CostRow
            label="Net (billed − cloud)"
            value={net}
            bold
            colorClass={net >= 0 ? 'text-emerald-600' : 'text-red-600'}
          />
          <div className="flex justify-between py-2 border-b border-zinc-100">
            <span className="text-zinc-700 font-semibold">Margin %</span>
            <span className={`tabular-nums font-semibold ${net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {pct(net, cloudCosts.total)}
            </span>
          </div>
          <RatioRow label="User compute as % of cloud" value={pct(cloudCosts.production_compute, cloudCosts.total)} />
          <RatioRow label="Overhead as % of cloud" value={pct(systemOverhead, cloudCosts.total)} />
          <RatioRow label="Service fees as % of user billing" value={pct(userBilling.service_fee_cost, userBilling.total)} />
        </Panel>
      )}
    </div>
  );
}

const el = document.getElementById('cost-analysis-root');
if (el) {
  const monitoringBaseUrl = el.dataset.monitoringBaseUrl ?? '';
  const batchBaseUrl = el.dataset.batchBaseUrl ?? '';
  createRoot(el).render(<CostAnalysis monitoringBaseUrl={monitoringBaseUrl} batchBaseUrl={batchBaseUrl} />);
}
