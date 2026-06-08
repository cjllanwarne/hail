import { useState, useEffect, useCallback, useMemo } from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ScatterChart, Scatter, ZAxis } from 'recharts';

// --- Types ---

// GCP service name for the GKE cluster management fee line item
const GKE_SERVICE_NAME = 'Kubernetes Engine';

interface CloudCosts {
  user_compute: number;
  other_compute: number;
  k8s: number;
  other_overhead: number;
  total: number;
  // other_compute sub-breakdown
  batch_test: number;
  batch_dev: number;
  unknown: number;
  // k8s sub-breakdown
  k8s_nodes: number;
  k8s_mgmt: number;
  // other_overhead sub-breakdown (excludes Kubernetes Engine)
  non_compute_services: Record<string, number>;
  // user_compute sub-breakdown by SKU product name
  user_compute_by_product: Record<string, number>;
}

interface BillingRow {
  resource: string;
  cost: number;
}

interface UserBilling {
  total: number;
  resource_cost: number;
  service_fee_cost: number;
  resource_by_type: Record<string, number>;
}

interface MonthDataPoint {
  month: string;
  cloud_total: number;
  user_compute: number;
  other_compute: number;
  k8s: number;
  other_overhead: number;
  batch_test: number;
  batch_dev: number;
  unknown: number;
  k8s_nodes: number;
  k8s_mgmt: number;
  non_compute_services: Record<string, number>;
  user_compute_by_product: Record<string, number>;
  resource_by_type: Record<string, number>;
  user_billing: number;
  service_fees: number;
  resource_cost: number;
  profit: number;
  svc_fee_overhead_pct: number | null;
  resource_billing_pct: number | null;
  svc_fee_bill_pct: number | null;
  overhead_cloud_pct: number | null;
  overhead_resource_pct: number | null;
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

function makeYDollarFormatter(domainMax: number): (v: number) => string {
  if (domainMax < 1000) return v => `$${Math.round(v)}`;
  if (domainMax < 10000) return v => `$${(v / 1000).toFixed(1)}k`;
  return v => `$${(v / 1000).toFixed(0)}k`;
}

function fmtCoreHours(v: number): string {
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return '—';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function shiftMonthParam(param: string, delta: number): string {
  const [mm, yyyy] = param.split('/');
  const d = new Date(parseInt(yyyy), parseInt(mm) - 1 + delta, 1);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function monthParamToLabel(param: string): string {
  const [mm, yyyy] = param.split('/');
  return new Date(parseInt(yyyy), parseInt(mm) - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

// --- Custom ratio field helpers ---

interface FieldGroup { group: string; fields: { id: string; label: string }[] }

function buildFieldGroups(products: string[], nonComputeServices: string[], resourceTypes: string[]): FieldGroup[] {
  return [
    {
      group: 'Cloud Costs',
      fields: [
        { id: 'cloud/total', label: 'Cloud Costs / Total' },
        { id: 'cloud/user_compute', label: 'Cloud Costs / User-driven compute' },
        ...products.map(p => ({ id: `cloud/user_compute/${p}`, label: `Cloud Costs / User-driven compute / ${p}` })),
        { id: 'cloud/other_compute', label: 'Cloud Costs / Other compute' },
        { id: 'cloud/batch_test', label: 'Cloud Costs / Other compute / CI/test batches' },
        { id: 'cloud/batch_dev', label: 'Cloud Costs / Other compute / Dev batches' },
        { id: 'cloud/unknown', label: 'Cloud Costs / Other compute / Unknown/unlabeled' },
        { id: 'cloud/k8s', label: 'Cloud Costs / K8s' },
        { id: 'cloud/k8s_nodes', label: 'Cloud Costs / K8s / Nodes' },
        { id: 'cloud/k8s_mgmt', label: 'Cloud Costs / K8s / Management' },
        { id: 'cloud/other_overhead', label: 'Cloud Costs / Other overhead' },
        ...nonComputeServices.map(s => ({ id: `cloud/non_compute/${s}`, label: `Cloud Costs / Other overhead / ${s}` })),
      ],
    },
    {
      group: 'User Billing',
      fields: [
        { id: 'billing/total', label: 'User Billing / Total' },
        { id: 'billing/resource_cost', label: 'User Billing / Resource cost' },
        ...resourceTypes.map(r => ({ id: `billing/resource/${r}`, label: `User Billing / Resource cost / ${r}` })),
        { id: 'billing/service_fees', label: 'User Billing / Service fees' },
      ],
    },
    {
      group: 'Margin Analysis',
      fields: [
        { id: 'margin/profit', label: 'Margin Analysis / Profit ($)' },
        { id: 'margin/margin_pct', label: 'Margin Analysis / Margin %' },
      ],
    },
    {
      group: 'Usage',
      fields: [
        { id: 'derived/core_hours', label: 'Usage / Core hours' },
      ],
    },
  ];
}

function fieldLabel(id: string, groups: FieldGroup[]): string {
  for (const g of groups) {
    const f = g.fields.find(f => f.id === id);
    if (f) return f.label;
  }
  return id;
}

function resolveMonthly(id: string, c: CloudCosts, b: UserBilling): number {
  if (id === 'cloud/total') return c.total;
  if (id === 'cloud/user_compute') return c.user_compute;
  if (id.startsWith('cloud/user_compute/')) return c.user_compute_by_product[id.slice(19)] ?? 0;
  if (id === 'cloud/other_compute') return c.other_compute;
  if (id === 'cloud/batch_test') return c.batch_test;
  if (id === 'cloud/batch_dev') return c.batch_dev;
  if (id === 'cloud/unknown') return c.unknown;
  if (id === 'cloud/k8s') return c.k8s;
  if (id === 'cloud/k8s_nodes') return c.k8s_nodes;
  if (id === 'cloud/k8s_mgmt') return c.k8s_mgmt;
  if (id === 'cloud/other_overhead') return c.other_overhead;
  if (id.startsWith('cloud/non_compute/')) return c.non_compute_services[id.slice(18)] ?? 0;
  if (id === 'billing/total') return b.total;
  if (id === 'billing/resource_cost') return b.resource_cost;
  if (id.startsWith('billing/resource/')) return b.resource_by_type[id.slice(17)] ?? 0;
  if (id === 'billing/service_fees') return b.service_fee_cost;
  if (id === 'margin/profit') return b.total - c.total;
  if (id === 'margin/margin_pct') return b.total === 0 ? 0 : ((b.total - c.total) / b.total) * 100;
  if (id === 'derived/core_hours') return b.service_fee_cost * 100;
  return 0;
}

function resolveTrend(id: string, p: MonthDataPoint): number {
  if (id === 'cloud/total') return p.cloud_total;
  if (id === 'cloud/user_compute') return p.user_compute;
  if (id.startsWith('cloud/user_compute/')) return (p.user_compute_by_product ?? {})[id.slice(19)] ?? 0;
  if (id === 'cloud/other_compute') return p.other_compute;
  if (id === 'cloud/batch_test') return p.batch_test;
  if (id === 'cloud/batch_dev') return p.batch_dev;
  if (id === 'cloud/unknown') return p.unknown;
  if (id === 'cloud/k8s') return p.k8s;
  if (id === 'cloud/k8s_nodes') return p.k8s_nodes;
  if (id === 'cloud/k8s_mgmt') return p.k8s_mgmt;
  if (id === 'cloud/other_overhead') return p.other_overhead;
  if (id.startsWith('cloud/non_compute/')) return (p.non_compute_services ?? {})[id.slice(18)] ?? 0;
  if (id === 'billing/total') return p.user_billing;
  if (id === 'billing/resource_cost') return p.resource_cost;
  if (id.startsWith('billing/resource/')) return (p.resource_by_type ?? {})[id.slice(17)] ?? 0;
  if (id === 'billing/service_fees') return p.service_fees;
  if (id === 'margin/profit') return p.profit;
  if (id === 'margin/margin_pct') return p.user_billing === 0 ? 0 : (p.profit / p.user_billing) * 100;
  if (id === 'derived/core_hours') return p.service_fees * 100;
  return 0;
}

// --- API fetchers ---

async function fetchCloudCosts(monitoringBaseUrl: string, period: string): Promise<CloudCosts> {
  const resp = await fetch(`${monitoringBaseUrl}/api/v1alpha/billing?time_period=${encodeURIComponent(period)}`);
  if (!resp.ok) throw new Error(`Cloud billing fetch failed (HTTP ${resp.status})`);
  const data = await resp.json();

  const breakdown: { source: string; cost: string }[] = data['compute_cost_breakdown'] ?? [];
  const byService: { service: string; cost: string }[] = data['cost_by_service'] ?? [];
  const bySkuLabel: { source: string | null; sku_description: string; cost: string }[] = data['cost_by_sku_label'] ?? [];

  const costs: CloudCosts = { user_compute: 0, other_compute: 0, k8s: 0, other_overhead: 0, total: 0, batch_test: 0, batch_dev: 0, unknown: 0, k8s_nodes: 0, k8s_mgmt: 0, non_compute_services: {}, user_compute_by_product: {} };
  let computeTotal = 0;
  for (const row of breakdown) {
    const cost = parseCostStr(row.cost);
    computeTotal += cost;
    if (row.source === 'batch-production') costs.user_compute += cost;
    else if (row.source === 'k8s') { costs.k8s_nodes += cost; costs.k8s += cost; }
    else {
      costs.other_compute += cost;
      if (row.source === 'batch-test') costs.batch_test += cost;
      else if (row.source === 'batch-dev') costs.batch_dev += cost;
      else costs.unknown += cost;
    }
  }
  for (const row of byService) {
    const cost = parseCostStr(row.cost);
    if (row.service === 'Compute Engine') continue;
    if (row.service === GKE_SERVICE_NAME) { costs.k8s_mgmt += cost; costs.k8s += cost; }
    else { costs.non_compute_services[row.service] = (costs.non_compute_services[row.service] ?? 0) + cost; }
  }
  for (const row of bySkuLabel) {
    if (row.source === 'batch-production') {
      const cost = parseCostStr(row.cost);
      costs.user_compute_by_product[row.sku_description] = (costs.user_compute_by_product[row.sku_description] ?? 0) + cost;
    }
  }
  const cloudTotal = byService.reduce((sum, row) => sum + parseCostStr(row.cost), 0);
  costs.other_overhead = Math.max(0, cloudTotal - computeTotal - costs.k8s_mgmt);
  costs.total = cloudTotal;
  return costs;
}

async function fetchUserBilling(batchBaseUrl: string, period: string): Promise<UserBilling> {
  const { start, end } = monthToDateRange(period);
  const url = `${batchBaseUrl}/api/v1alpha/billing_breakdown?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`User billing fetch failed (HTTP ${resp.status})`);
  const rows: BillingRow[] = await resp.json();

  let total = 0;
  let service_fee_cost = 0;
  const resource_by_type: Record<string, number> = {};
  for (const row of rows) {
    total += row.cost;
    if (row.resource.startsWith('service-fee')) {
      service_fee_cost += row.cost;
    } else {
      const lastSlash = row.resource.lastIndexOf('/');
      const key = lastSlash !== -1 && /^\d+$/.test(row.resource.slice(lastSlash + 1))
        ? row.resource.slice(0, lastSlash)
        : row.resource;
      resource_by_type[key] = (resource_by_type[key] ?? 0) + row.cost;
    }
  }
  return { total, resource_cost: total - service_fee_cost, service_fee_cost, resource_by_type };
}

// --- Components ---

function CustomRatioPicker({ fieldGroups, num, den, onNumChange, onDenChange }: {
  fieldGroups: FieldGroup[];
  num: string; den: string;
  onNumChange: (v: string) => void;
  onDenChange: (v: string) => void;
}) {
  const selectClass = 'text-xs border border-zinc-300 rounded px-2 py-1 bg-white text-zinc-600 focus:outline-none focus:ring-2 focus:ring-sky-400 flex-1 min-w-0';
  const renderOptions = () => fieldGroups.map(g => (
    <optgroup key={g.group} label={g.group}>
      {g.fields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
    </optgroup>
  ));
  return (
    <div className="flex items-center gap-2 py-2 flex-wrap">
      <span className="text-xs text-zinc-500 shrink-0">Custom:</span>
      <select className={selectClass} value={num} onChange={e => onNumChange(e.target.value)}>{renderOptions()}</select>
      <span className="text-xs text-zinc-400 shrink-0">as % of</span>
      <select className={selectClass} value={den} onChange={e => onDenChange(e.target.value)}>{renderOptions()}</select>
    </div>
  );
}

interface PanelProps { title: string; subtitle?: string; collapsible?: boolean; viewSelector?: React.ReactNode; children: React.ReactNode }
function Panel({ title, subtitle, collapsible = false, viewSelector, children }: PanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
      <div className={`px-5 py-4 bg-zinc-50 flex items-center gap-2 ${!collapsed ? 'border-b border-zinc-200' : ''}`}>
        {collapsible && (
          <button onClick={() => setCollapsed(c => !c)} className="p-1 rounded hover:bg-zinc-200 text-zinc-400 transition-colors">
            <svg className={`w-4 h-4 transition-transform ${collapsed ? '' : 'rotate-90'}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.293 4.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        )}
        <div className="flex-1">
          <h2 className="text-base font-semibold text-zinc-800">{title}</h2>
          {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
        </div>
        {viewSelector && <div onClick={e => e.stopPropagation()}>{viewSelector}</div>}
      </div>
      {!collapsed && <div className="px-5 py-3">{children}</div>}
    </div>
  );
}

interface CostRowProps { label: string; value: number; pctStr?: string; indent?: boolean; bold?: boolean; colorClass?: string }
function CostRow({ label, value, pctStr, indent = false, bold = false, colorClass }: CostRowProps) {
  return (
    <div className={`flex items-center py-2 border-b border-zinc-100 last:border-0 ${indent ? 'pl-6' : ''}`}>
      <span className={`flex-1 min-w-0 text-zinc-700 ${bold ? 'font-semibold' : ''}`}>{label}</span>
      <span className="shrink-0 w-16 text-right tabular-nums text-zinc-400 text-sm">{pctStr ?? ''}</span>
      <span className={`shrink-0 w-28 text-right tabular-nums ${bold ? 'font-semibold' : ''} ${colorClass ?? ''}`}>{fmt(value)}</span>
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

type SeriesStats = Record<string, { mean: number; std: number } | null>;
interface ChartTooltipProps {
  active?: boolean;
  payload?: readonly { name?: string | number; value?: number | string | readonly (number | string)[]; dataKey?: string | number | ((obj: unknown) => unknown); color?: string; fill?: string }[];
  label?: string | number;
  stats: { mean: number; std: number } | null;
  seriesStats?: SeriesStats;
  format: (v: number) => string;
  stacked?: boolean;
}
function ChartTooltip({ active, payload, label, stats, seriesStats, format, stacked = false }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const numVal = (v?: number | string | readonly (number | string)[]) => typeof v === 'number' ? v : 0;
  const sigmaStr = (v: number, s: { mean: number; std: number } | null | undefined) => {
    if (!s || s.std === 0) return null;
    const z = (v - s.mean) / s.std;
    return `μ${z >= 0 ? '+' : '−'}${Math.abs(z).toFixed(1)}σ`;
  };
  const total = payload.reduce((s, p) => s + numVal(p.value), 0);
  const totalSigma = stacked && payload.length > 1 ? sigmaStr(total, stats) : null;
  return (
    <div className="bg-white border border-zinc-200 rounded shadow-lg px-3 py-2 text-sm min-w-max">
      <p className="font-medium text-zinc-700 mb-1">{label}</p>
      {payload.map((p, i) => {
        const val = numVal(p.value);
        const key = typeof p.dataKey === 'string' ? p.dataKey : undefined;
        const sg = sigmaStr(val, key && seriesStats ? seriesStats[key] : (payload.length === 1 ? stats : null));
        return (
          <div key={i} className="flex items-center gap-3 text-xs py-0.5">
            <span className="flex items-center gap-1 text-zinc-600 flex-1">
              <span style={{ color: p.fill ?? p.color }}>■</span>
              {p.name ?? ''}
            </span>
            <span className="tabular-nums font-medium text-zinc-800">{format(val)}</span>
            <span className="tabular-nums text-indigo-400 w-16 text-right">{sg ?? ''}</span>
          </div>
        );
      })}
      {stacked && payload.length > 1 && (
        <div className="flex items-center gap-3 text-xs pt-1 mt-0.5 border-t border-zinc-100">
          <span className="text-zinc-500 font-medium flex-1">Total</span>
          <span className="tabular-nums font-medium text-zinc-800">{format(total)}</span>
          <span className="tabular-nums text-indigo-400 w-16 text-right">{totalSigma ?? ''}</span>
        </div>
      )}
    </div>
  );
}

function StatLabel({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <span title={tooltip} className="cursor-help underline decoration-dotted decoration-zinc-400">
      {label}
    </span>
  );
}

function ToggleSwitch({ checked, onChange, label = '% of total' }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none" onClick={() => onChange(!checked)}>
      <div className={`relative w-8 h-4 rounded-full transition-colors ${checked ? 'bg-sky-500' : 'bg-zinc-300'}`}>
        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-xs text-zinc-600">{label}</span>
    </label>
  );
}

function StatsDisplay({ stats, format }: { stats: { mean: number; std: number } | null; format: (v: number) => string }) {
  if (!stats) return null;
  const { mean, std } = stats;
  const cv = mean !== 0 ? (std / mean) * 100 : null;
  return (
    <div className="flex gap-6 mt-2 pt-2 border-t border-zinc-100 text-xs tabular-nums text-zinc-500">
      <span>
        <StatLabel label="mean (μ)" tooltip="Average value across all months shown." />
        {' '}<span className="text-zinc-700 font-medium">{format(mean)}</span>
      </span>
      <span>
        <StatLabel label="std dev (σ)" tooltip="Standard deviation — how much individual months typically deviate from the mean. A higher value means more month-to-month variability." />
        {' '}<span className="text-zinc-700 font-medium">{format(std)}</span>
      </span>
      {cv !== null && (
        <span>
          <StatLabel label="CV" tooltip="Coefficient of Variation (σ ÷ μ × 100) — relative variability as a percentage of the mean. Useful for comparing volatility across metrics of different scales. Under ~15% is generally stable; over ~30% suggests high variability." />
          {' '}<span className="text-zinc-700 font-medium">{cv.toFixed(1)}%</span>
        </span>
      )}
    </div>
  );
}

// --- Stats helpers ---

function computeStats(values: number[]): { mean: number; std: number } | null {
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return { mean, std };
}

interface RegressionResult { slope: number; intercept: number; r2: number }

function computeRegression(points: { x: number; y: number }[]): RegressionResult | null {
  const n = points.length;
  if (n < 2) return null;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const meanY = sumY / n;
  const ssTot = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  const ssRes = points.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

function RegressionStatsDisplay({ reg, xLabel, yLabel, fmtX, fmtY }: {
  reg: RegressionResult | null;
  xLabel: string; yLabel: string;
  fmtX: (v: number) => string; fmtY: (v: number) => string;
}) {
  if (!reg) return null;
  const slopeTooltip = `For every 1-unit increase in ${xLabel}, ${yLabel} changes by this amount on average.`;
  const yInterceptTooltip = `Predicted value of ${yLabel} when ${xLabel} is zero.`;
  const xIntercept = reg.slope !== 0 ? -reg.intercept / reg.slope : null;
  const xInterceptTooltip = `Value of ${xLabel} at which the regression line predicts ${yLabel} reaches zero.`;
  const r2Tooltip = 'R² (coefficient of determination) — how well the regression line fits the data. 1.0 = perfect fit; 0 = no linear relationship.';
  return (
    <div className="flex gap-6 mt-2 pt-2 border-t border-zinc-100 text-xs tabular-nums text-zinc-500">
      <span>
        <StatLabel label="slope" tooltip={slopeTooltip} />
        {' '}<span className="text-zinc-700 font-medium">{fmtY(reg.slope)}/{fmtX(1).replace('$', '')}</span>
      </span>
      <span>
        <StatLabel label="y-intercept" tooltip={yInterceptTooltip} />
        {' '}<span className="text-zinc-700 font-medium">{fmtY(reg.intercept)}</span>
      </span>
      {xIntercept !== null && (
        <span>
          <StatLabel label="x-intercept" tooltip={xInterceptTooltip} />
          {' '}<span className="text-zinc-700 font-medium">{fmtX(xIntercept)}</span>
        </span>
      )}
      <span>
        <StatLabel label="R²" tooltip={r2Tooltip} />
        {' '}<span className="text-zinc-700 font-medium">{reg.r2.toFixed(3)}</span>
      </span>
    </div>
  );
}

function statsReferenceLines(stats: { mean: number; std: number } | null, yMin: number, yMax: number) {
  if (!stats) return null;
  const { mean, std } = stats;
  return [
    { y: mean - 2 * std, label: 'μ−2σ', solid: false, alpha: 0.35 },
    { y: mean - std,     label: 'μ−σ',  solid: false, alpha: 0.55 },
    { y: mean,           label: 'μ',    solid: true,  alpha: 0.8  },
    { y: mean + std,     label: 'μ+σ',  solid: false, alpha: 0.55 },
    { y: mean + 2 * std, label: 'μ+2σ', solid: false, alpha: 0.35 },
  ]
    .filter(e => e.y >= yMin && e.y <= yMax)
    .map(e => (
      <ReferenceLine
        key={e.label}
        y={e.y}
        stroke="#818cf8"
        strokeOpacity={e.alpha}
        strokeWidth={e.solid ? 1.5 : 1}
        strokeDasharray={e.solid ? undefined : '4 3'}
        label={{ value: e.label, position: 'insideTopRight', fontSize: 9, fill: '#818cf8', fillOpacity: e.alpha }}
      />
    ));
}

function toPctRows<T extends Record<string, unknown>>(rows: T[], keys: string[]): T[] {
  return rows.map(row => {
    const total = keys.reduce((s, k) => s + (typeof row[k] === 'number' ? (row[k] as number) : 0), 0);
    if (total === 0) return row;
    const result = { ...row } as Record<string, unknown>;
    for (const k of keys) {
      if (typeof result[k] === 'number') result[k] = ((result[k] as number) / total) * 100;
    }
    return result as T;
  });
}

interface PieSlice { name: string; value: number; fill: string }
function MiniPieChart({ data, size = 'md' }: { data: PieSlice[]; size?: 'sm' | 'md' }) {
  const height = size === 'sm' ? 110 : 156;
  const innerR = size === 'sm' ? 28 : 42;
  const outerR = size === 'sm' ? 46 : 64;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={innerR} outerRadius={outerR} dataKey="value" paddingAngle={2}>
          {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
        </Pie>
        <Tooltip formatter={(v) => typeof v === 'number' ? fmt(v) : ''} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// --- Legend toggle hook ---

function useLegendToggle(allKeys: readonly string[]) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const onLegendClick = useCallback(
    (e: { dataKey?: string | number | ((obj: unknown) => unknown) }, _index: number, event: { shiftKey: boolean }) => {
      if (typeof e.dataKey !== 'string') return;
      const key = e.dataKey;
      if (event.shiftKey) {
        // shift-click: toggle this series on/off
        setHidden(prev => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key); else next.add(key);
          return next;
        });
      } else {
        // click: solo this series (or restore all if already soloed)
        setHidden(prev => {
          const visible = allKeys.filter(k => !prev.has(k));
          const isSolo = visible.length === 1 && visible[0] === key;
          return isSolo ? new Set() : new Set(allKeys.filter(k => k !== key));
        });
      }
    },
    [allKeys]
  );
  const isHidden = (key: string) => hidden.has(key);
  return { onLegendClick, isHidden };
}

// --- Preset quick-links ---

const RATIO_PRESETS: { label: string; num: string; den: string }[] = [
  { label: 'Resource billing as % of user compute',  num: 'billing/resource_cost',  den: 'cloud/user_compute' },
  { label: 'Service fees as % of user bill',          num: 'billing/service_fees',   den: 'billing/total' },
  { label: 'Service fees as % of other overhead',    num: 'billing/service_fees',   den: 'cloud/other_overhead' },
  { label: 'Other overhead as % of cloud costs',     num: 'cloud/other_overhead',   den: 'cloud/total' },
  { label: 'K8s as % of cloud costs',                num: 'cloud/k8s',              den: 'cloud/total' },
  { label: 'User billing as % of cloud costs',       num: 'billing/total',          den: 'cloud/total' },
];

const SCATTER_PRESETS: { label: string; x: string; y: string }[] = [
  { label: 'Core hours vs Profit',             x: 'derived/core_hours', y: 'margin/profit' },
  { label: 'Cloud total vs Profit',            x: 'cloud/total',        y: 'margin/profit' },
  { label: 'User compute vs Resource billing', x: 'cloud/user_compute', y: 'billing/resource_cost' },
  { label: 'Cloud total vs User billing',      x: 'cloud/total',        y: 'billing/total' },
  { label: 'Other overhead vs Profit',         x: 'cloud/other_overhead', y: 'margin/profit' },
  { label: 'User compute vs Margin %',         x: 'cloud/user_compute', y: 'margin/margin_pct' },
];

function PresetChips({ presets, activeNum, activeDen, onSelect }: {
  presets: { label: string; num: string; den: string }[];
  activeNum: string; activeDen: string;
  onSelect: (num: string, den: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 py-2">
      {presets.map(p => {
        const active = p.num === activeNum && p.den === activeDen;
        return (
          <button
            key={p.label}
            onClick={() => onSelect(p.num, p.den)}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${active ? 'bg-sky-500 border-sky-500 text-white' : 'border-zinc-300 text-zinc-500 hover:border-sky-400 hover:text-sky-600 bg-white'}`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function ScatterPresetChips({ presets, activeX, activeY, onSelect }: {
  presets: { label: string; x: string; y: string }[];
  activeX: string; activeY: string;
  onSelect: (x: string, y: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 py-2">
      {presets.map(p => {
        const active = p.x === activeX && p.y === activeY;
        return (
          <button
            key={p.label}
            onClick={() => onSelect(p.x, p.y)}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${active ? 'bg-sky-500 border-sky-500 text-white' : 'border-zinc-300 text-zinc-500 hover:border-sky-400 hover:text-sky-600 bg-white'}`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

// --- Main component ---

interface CostAnalysisProps { monitoringBaseUrl: string; batchBaseUrl: string }

export function CostAnalysis({ monitoringBaseUrl, batchBaseUrl }: CostAnalysisProps) {
  const [tab, setTab] = useState<'monthly' | 'trends'>(() => {
    const p = new URLSearchParams(window.location.search).get('tab');
    return p === 'trends' ? 'trends' : 'monthly';
  });

  const changeTab = useCallback((t: 'monthly' | 'trends') => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', t);
    window.history.replaceState(null, '', url.toString());
  }, []);
  const [cloudView, setCloudView] = useState<'summary' | 'user_compute' | 'other_compute' | 'k8s' | 'other_overhead'>('summary');
  const [billingView, setBillingView] = useState<'summary' | 'resource_usage'>('summary');
  const cloudCostsToggle = useLegendToggle(['user_compute', 'other_compute', 'k8s', 'other_overhead'] as const);
  const otherComputeToggle = useLegendToggle(['batch_test', 'batch_dev', 'unknown'] as const);
  const k8sToggle = useLegendToggle(['k8s_nodes', 'k8s_mgmt'] as const);
  const billingToggle = useLegendToggle(['resource_cost', 'service_fees'] as const);
  const [cloudShowPct, setCloudShowPct] = useState(false);
  const [billingShowPct, setBillingShowPct] = useState(false);
  const [timePeriod, setTimePeriod] = useState(currentMonthParam());
  const [cloudCosts, setCloudCosts] = useState<CloudCosts | null>(null);
  const [userBilling, setUserBilling] = useState<UserBilling | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [trendData, setTrendData] = useState<MonthDataPoint[]>([]);
  const [customRatioNum, setCustomRatioNum] = useState('billing/resource_cost');
  const [customRatioDen, setCustomRatioDen] = useState('cloud/user_compute');
  const [scatterX, setScatterX] = useState('derived/core_hours');
  const [scatterY, setScatterY] = useState('margin/profit');
  const [showRegression, setShowRegression] = useState(false);
  const [trendsLoading, setTrendsLoading] = useState(false);

  const [compareTimePeriod, setCompareTimePeriod] = useState<string | null>(null);
  const [compareCloudCosts, setCompareCloudCosts] = useState<CloudCosts | null>(null);
  const [compareUserBilling, setCompareUserBilling] = useState<UserBilling | null>(null);
  const [compareCloudError, setCompareCloudError] = useState<string | null>(null);
  const [compareBillingError, setCompareBillingError] = useState<string | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  const overheadServices = useMemo(() => {
    const seen = new Set<string>();
    for (const d of trendData) Object.keys(d.non_compute_services).forEach(s => seen.add(s));
    if (cloudCosts) Object.keys(cloudCosts.non_compute_services).forEach(s => seen.add(s));
    return Array.from(seen).sort();
  }, [trendData, cloudCosts]);

  const { billingResources, billingResourcesHasOther } = useMemo(() => {
    const maxes: Record<string, number> = {};
    for (const d of trendData) {
      for (const [r, v] of Object.entries(d.resource_by_type)) maxes[r] = Math.max(maxes[r] ?? 0, v);
    }
    if (userBilling) {
      for (const [r, v] of Object.entries(userBilling.resource_by_type)) maxes[r] = Math.max(maxes[r] ?? 0, v);
    }
    const resources = Object.keys(maxes).filter(r => maxes[r] >= 10).sort();
    const hasOther = Object.keys(maxes).some(r => maxes[r] < 10);
    return { billingResources: resources, billingResourcesHasOther: hasOther };
  }, [trendData, userBilling]);

  const { billingResourcesMonthly, billingResourcesMonthlyHasOther } = useMemo(() => {
    if (!userBilling) return { billingResourcesMonthly: [] as string[], billingResourcesMonthlyHasOther: false };
    const resources = Object.entries(userBilling.resource_by_type).filter(([, v]) => v >= 10).sort(([, a], [, b]) => b - a).map(([r]) => r);
    const hasOther = Object.values(userBilling.resource_by_type).some(v => v < 10);
    return { billingResourcesMonthly: resources, billingResourcesMonthlyHasOther: hasOther };
  }, [userBilling]);

  const brOther = useCallback(
    (byType: Record<string, number>) =>
      Object.entries(byType).filter(([r]) => !billingResources.includes(r)).reduce((s, [, v]) => s + v, 0),
    [billingResources]
  );

  const brOtherMonthly = useCallback(
    (byType: Record<string, number>) =>
      Object.entries(byType).filter(([r]) => !billingResourcesMonthly.includes(r)).reduce((s, [, v]) => s + v, 0),
    [billingResourcesMonthly]
  );

  const { userComputeProducts, userComputeHasOther } = useMemo(() => {
    const maxes: Record<string, number> = {};
    for (const d of trendData) {
      for (const [p, v] of Object.entries(d.user_compute_by_product)) maxes[p] = Math.max(maxes[p] ?? 0, v);
    }
    const products = Object.keys(maxes).filter(p => maxes[p] >= 10).sort();
    const hasOther = Object.keys(maxes).some(p => maxes[p] < 10);
    return { userComputeProducts: products, userComputeHasOther: hasOther };
  }, [trendData]);

  const ucOther = useCallback(
    (byProduct: Record<string, number>) =>
      Object.entries(byProduct).filter(([p]) => !userComputeProducts.includes(p)).reduce((s, [, v]) => s + v, 0),
    [userComputeProducts]
  );

  const { userComputeMonthlyProducts, userComputeMonthlyHasOther } = useMemo(() => {
    if (!cloudCosts) return { userComputeMonthlyProducts: [] as string[], userComputeMonthlyHasOther: false };
    const products = Object.entries(cloudCosts.user_compute_by_product).filter(([, v]) => v >= 10).sort(([, a], [, b]) => b - a).map(([p]) => p);
    const hasOther = Object.values(cloudCosts.user_compute_by_product).some(v => v < 10);
    return { userComputeMonthlyProducts: products, userComputeMonthlyHasOther: hasOther };
  }, [cloudCosts]);

  const fieldGroups = useMemo<FieldGroup[]>(() => {
    const products = new Set<string>();
    const nonComputeServices = new Set<string>();
    const resourceTypes = new Set<string>();
    if (cloudCosts) {
      Object.keys(cloudCosts.user_compute_by_product).forEach(p => products.add(p));
      Object.keys(cloudCosts.non_compute_services).forEach(s => nonComputeServices.add(s));
    }
    if (userBilling) Object.keys(userBilling.resource_by_type).forEach(r => resourceTypes.add(r));
    trendData.forEach(d => {
      Object.keys(d.user_compute_by_product ?? {}).forEach(p => products.add(p));
      Object.keys(d.non_compute_services ?? {}).forEach(s => nonComputeServices.add(s));
      Object.keys(d.resource_by_type ?? {}).forEach(r => resourceTypes.add(r));
    });
    return buildFieldGroups([...products].sort(), [...nonComputeServices].sort(), [...resourceTypes].sort());
  }, [cloudCosts, userBilling, trendData]);

  const ucOtherMonthly = useCallback(
    (byProduct: Record<string, number>) =>
      Object.entries(byProduct).filter(([p]) => !userComputeMonthlyProducts.includes(p)).reduce((s, [, v]) => s + v, 0),
    [userComputeMonthlyProducts]
  );

  const cloudSeriesKeys = useMemo(() => {
    if (cloudView === 'user_compute') return [...userComputeProducts, ...(userComputeHasOther ? ['(Other)'] : [])];
    if (cloudView === 'other_compute') return ['batch_test', 'batch_dev', 'unknown'];
    if (cloudView === 'k8s') return ['k8s_nodes', 'k8s_mgmt'];
    if (cloudView === 'other_overhead') return [...overheadServices];
    return ['user_compute', 'other_compute', 'k8s', 'other_overhead'];
  }, [cloudView, userComputeProducts, userComputeHasOther, overheadServices]);

  const cloudBaseData = useMemo(() => {
    if (cloudView === 'user_compute')
      return trendData.map(d => ({ month: d.month, ...Object.fromEntries(userComputeProducts.map(p => [p, d.user_compute_by_product[p] ?? 0])), ...(userComputeHasOther ? { '(Other)': ucOther(d.user_compute_by_product) } : {}) }));
    if (cloudView === 'other_overhead')
      return trendData.map(d => ({ month: d.month, ...Object.fromEntries(overheadServices.map(svc => [svc, d.non_compute_services[svc] ?? 0])) }));
    return trendData as unknown[];
  }, [cloudView, trendData, userComputeProducts, userComputeHasOther, ucOther, overheadServices]);

  const cloudChartData = useMemo(
    () => cloudShowPct ? toPctRows(cloudBaseData as Record<string, unknown>[], cloudSeriesKeys) : cloudBaseData,
    [cloudShowPct, cloudBaseData, cloudSeriesKeys]
  );

  const billingSeriesKeys = useMemo(() => {
    if (billingView === 'resource_usage') return [...billingResources, ...(billingResourcesHasOther ? ['(Other)'] : [])];
    return ['resource_cost', 'service_fees'];
  }, [billingView, billingResources, billingResourcesHasOther]);

  const billingBaseData = useMemo(() => {
    if (billingView === 'resource_usage')
      return trendData.map(d => ({ month: d.month, ...Object.fromEntries(billingResources.map(r => [r, d.resource_by_type[r] ?? 0])), ...(billingResourcesHasOther ? { '(Other)': brOther(d.resource_by_type) } : {}) }));
    return trendData as unknown[];
  }, [billingView, trendData, billingResources, billingResourcesHasOther, brOther]);

  const billingChartData = useMemo(
    () => billingShowPct ? toPctRows(billingBaseData as Record<string, unknown>[], billingSeriesKeys) : billingBaseData,
    [billingShowPct, billingBaseData, billingSeriesKeys]
  );

  const OVERHEAD_PALETTE = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#818cf8', '#4f46e5', '#7c3aed', '#9333ea', '#a855f7', '#c026d3'];
  const overheadServiceColor = (svc: string) => OVERHEAD_PALETTE[overheadServices.indexOf(svc) % OVERHEAD_PALETTE.length];

  const overheadAllKeys = useMemo(() => [...overheadServices], [overheadServices]);
  const [overheadHidden, setOverheadHidden] = useState<Set<string>>(new Set());
  const onOverheadLegendClick = useCallback(
    (e: { dataKey?: string | number | ((obj: unknown) => unknown) }, _index: number, event: { shiftKey: boolean }) => {
      if (typeof e.dataKey !== 'string') return;
      const key = e.dataKey;
      if (event.shiftKey) {
        setOverheadHidden(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
      } else {
        setOverheadHidden(prev => {
          const visible = overheadAllKeys.filter(k => !prev.has(k));
          const isSolo = visible.length === 1 && visible[0] === key;
          return isSolo ? new Set() : new Set(overheadAllKeys.filter(k => k !== key));
        });
      }
    },
    [overheadAllKeys]
  );
  const isOverheadHidden = (key: string) => overheadHidden.has(key);

  const BILLING_RESOURCE_PALETTE = ['#10b981', '#059669', '#34d399', '#047857', '#6ee7b7', '#065f46', '#a7f3d0', '#14b8a6', '#0d9488', '#2dd4bf'];
  const billingResourceColor = (r: string) => r === '(Other)' ? '#9ca3af' : BILLING_RESOURCE_PALETTE[billingResources.indexOf(r) % BILLING_RESOURCE_PALETTE.length];

  const billingResourceAllKeys = useMemo(
    () => [...billingResources, ...(billingResourcesHasOther ? ['(Other)'] : [])],
    [billingResources, billingResourcesHasOther]
  );
  const [billingResourceHidden, setBillingResourceHidden] = useState<Set<string>>(new Set());
  const onBillingResourceLegendClick = useCallback(
    (e: { dataKey?: string | number | ((obj: unknown) => unknown) }, _index: number, event: { shiftKey: boolean }) => {
      if (typeof e.dataKey !== 'string') return;
      const key = e.dataKey;
      if (event.shiftKey) {
        setBillingResourceHidden(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
      } else {
        setBillingResourceHidden(prev => {
          const visible = billingResourceAllKeys.filter(k => !prev.has(k));
          const isSolo = visible.length === 1 && visible[0] === key;
          return isSolo ? new Set() : new Set(billingResourceAllKeys.filter(k => k !== key));
        });
      }
    },
    [billingResourceAllKeys]
  );
  const isBillingResourceHidden = (key: string) => billingResourceHidden.has(key);

  const USER_COMPUTE_PALETTE = ['#0ea5e9', '#38bdf8', '#7dd3fc', '#bae6fd', '#0284c7', '#0369a1', '#075985', '#0c4a6e', '#22d3ee', '#06b6d4'];
  const userComputeProductColor = (p: string) => p === '(Other)' ? '#9ca3af' : USER_COMPUTE_PALETTE[userComputeProducts.indexOf(p) % USER_COMPUTE_PALETTE.length];
  const userComputeMonthlyProductColor = (p: string) => p === '(Other)' ? '#9ca3af' : USER_COMPUTE_PALETTE[userComputeMonthlyProducts.indexOf(p) % USER_COMPUTE_PALETTE.length];

  const userComputeAllKeys = useMemo(
    () => [...userComputeProducts, ...(userComputeHasOther ? ['(Other)'] : [])],
    [userComputeProducts, userComputeHasOther]
  );
  const [userComputeHidden, setUserComputeHidden] = useState<Set<string>>(new Set());
  const onUserComputeLegendClick = useCallback(
    (e: { dataKey?: string | number | ((obj: unknown) => unknown) }, _index: number, event: { shiftKey: boolean }) => {
      if (typeof e.dataKey !== 'string') return;
      const key = e.dataKey;
      if (event.shiftKey) {
        setUserComputeHidden(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
      } else {
        setUserComputeHidden(prev => {
          const visible = userComputeAllKeys.filter(k => !prev.has(k));
          const isSolo = visible.length === 1 && visible[0] === key;
          return isSolo ? new Set() : new Set(userComputeAllKeys.filter(k => k !== key));
        });
      }
    },
    [userComputeAllKeys]
  );
  const isUserComputeHidden = (key: string) => userComputeHidden.has(key);

  const cloudYMax = Math.max(
    0,
    ...trendData.map(d =>
      cloudView === 'user_compute'
        ? userComputeProducts.reduce((s, p) => s + (isUserComputeHidden(p) ? 0 : (d.user_compute_by_product[p] ?? 0)), 0) +
          (userComputeHasOther && !isUserComputeHidden('(Other)') ? ucOther(d.user_compute_by_product) : 0)
        : cloudView === 'other_compute'
          ? (otherComputeToggle.isHidden('batch_test') ? 0 : d.batch_test) +
            (otherComputeToggle.isHidden('batch_dev') ? 0 : d.batch_dev) +
            (otherComputeToggle.isHidden('unknown') ? 0 : d.unknown)
          : cloudView === 'k8s'
            ? (k8sToggle.isHidden('k8s_nodes') ? 0 : d.k8s_nodes) +
              (k8sToggle.isHidden('k8s_mgmt') ? 0 : d.k8s_mgmt)
            : cloudView === 'other_overhead'
              ? overheadServices.reduce((s, svc) => s + (isOverheadHidden(svc) ? 0 : (d.non_compute_services[svc] ?? 0)), 0)
              : (cloudCostsToggle.isHidden('user_compute') ? 0 : d.user_compute) +
                (cloudCostsToggle.isHidden('other_compute') ? 0 : d.other_compute) +
                (cloudCostsToggle.isHidden('k8s') ? 0 : d.k8s) +
                (cloudCostsToggle.isHidden('other_overhead') ? 0 : d.other_overhead)
    ),
  );
  const billingYMax = Math.max(
    0,
    ...trendData.map(d =>
      billingView === 'resource_usage'
        ? billingResources.reduce((s, r) => s + (isBillingResourceHidden(r) ? 0 : (d.resource_by_type[r] ?? 0)), 0) +
          (billingResourcesHasOther && !isBillingResourceHidden('(Other)') ? brOther(d.resource_by_type) : 0)
        : (billingToggle.isHidden('resource_cost') ? 0 : d.resource_cost) +
          (billingToggle.isHidden('service_fees') ? 0 : d.service_fees)
    ),
  );

  const profitYExtent = Math.max(0, ...trendData.map(d => Math.abs(d.profit)));

  const cloudStats = computeStats(trendData.map(d =>
    cloudView === 'user_compute'
      ? userComputeProducts.reduce((s, p) => s + (isUserComputeHidden(p) ? 0 : (d.user_compute_by_product[p] ?? 0)), 0) +
        (userComputeHasOther && !isUserComputeHidden('(Other)') ? ucOther(d.user_compute_by_product) : 0)
      : cloudView === 'other_compute'
        ? (otherComputeToggle.isHidden('batch_test') ? 0 : d.batch_test) +
          (otherComputeToggle.isHidden('batch_dev') ? 0 : d.batch_dev) +
          (otherComputeToggle.isHidden('unknown') ? 0 : d.unknown)
        : cloudView === 'k8s'
          ? (k8sToggle.isHidden('k8s_nodes') ? 0 : d.k8s_nodes) +
            (k8sToggle.isHidden('k8s_mgmt') ? 0 : d.k8s_mgmt)
          : cloudView === 'other_overhead'
            ? overheadServices.reduce((s, svc) => s + (isOverheadHidden(svc) ? 0 : (d.non_compute_services[svc] ?? 0)), 0)
            : (cloudCostsToggle.isHidden('user_compute') ? 0 : d.user_compute) +
              (cloudCostsToggle.isHidden('other_compute') ? 0 : d.other_compute) +
              (cloudCostsToggle.isHidden('k8s') ? 0 : d.k8s) +
              (cloudCostsToggle.isHidden('other_overhead') ? 0 : d.other_overhead)
  ));
  const cloudSeriesStats: SeriesStats = cloudView === 'user_compute'
    ? {
        ...Object.fromEntries(userComputeProducts.map(p => [p, computeStats(trendData.map(d => d.user_compute_by_product[p] ?? 0))])),
        ...(userComputeHasOther ? { '(Other)': computeStats(trendData.map(d => ucOther(d.user_compute_by_product))) } : {}),
      }
    : cloudView === 'other_compute'
      ? {
          batch_test: computeStats(trendData.map(d => d.batch_test)),
          batch_dev: computeStats(trendData.map(d => d.batch_dev)),
          unknown: computeStats(trendData.map(d => d.unknown)),
        }
      : cloudView === 'k8s'
        ? {
            k8s_nodes: computeStats(trendData.map(d => d.k8s_nodes)),
            k8s_mgmt: computeStats(trendData.map(d => d.k8s_mgmt)),
          }
        : cloudView === 'other_overhead'
          ? Object.fromEntries(overheadServices.map(svc => [svc, computeStats(trendData.map(d => d.non_compute_services[svc] ?? 0))]))
          : {
              user_compute: computeStats(trendData.map(d => d.user_compute)),
              other_compute: computeStats(trendData.map(d => d.other_compute)),
              k8s: computeStats(trendData.map(d => d.k8s)),
              other_overhead: computeStats(trendData.map(d => d.other_overhead)),
            };
  const billingStats = computeStats(trendData.map(d =>
    billingView === 'resource_usage'
      ? billingResources.reduce((s, r) => s + (isBillingResourceHidden(r) ? 0 : (d.resource_by_type[r] ?? 0)), 0) +
        (billingResourcesHasOther && !isBillingResourceHidden('(Other)') ? brOther(d.resource_by_type) : 0)
      : (billingToggle.isHidden('resource_cost') ? 0 : d.resource_cost) +
        (billingToggle.isHidden('service_fees') ? 0 : d.service_fees)
  ));
  const billingSeriesStats: SeriesStats = billingView === 'resource_usage'
    ? {
        ...Object.fromEntries(billingResources.map(r => [r, computeStats(trendData.map(d => d.resource_by_type[r] ?? 0))])),
        ...(billingResourcesHasOther ? { '(Other)': computeStats(trendData.map(d => brOther(d.resource_by_type))) } : {}),
      }
    : {
        resource_cost: computeStats(trendData.map(d => d.resource_cost)),
        service_fees: computeStats(trendData.map(d => d.service_fees)),
      };
  const rowNum = (row: Record<string, unknown>, k: string) => typeof row[k] === 'number' ? row[k] as number : 0;

  const cloudPctRows = cloudChartData as Record<string, unknown>[];
  const cloudPctStats = computeStats(cloudPctRows.map(row =>
    cloudView === 'user_compute'
      ? [...userComputeProducts.filter(p => !isUserComputeHidden(p)), ...(userComputeHasOther && !isUserComputeHidden('(Other)') ? ['(Other)'] : [])].reduce((s, k) => s + rowNum(row, k), 0)
      : cloudView === 'other_compute'
        ? (['batch_test', 'batch_dev', 'unknown'] as const).filter(k => !otherComputeToggle.isHidden(k)).reduce((s, k) => s + rowNum(row, k), 0)
        : cloudView === 'k8s'
          ? (['k8s_nodes', 'k8s_mgmt'] as const).filter(k => !k8sToggle.isHidden(k)).reduce((s, k) => s + rowNum(row, k), 0)
          : cloudView === 'other_overhead'
            ? overheadServices.filter(s => !isOverheadHidden(s)).reduce((s, k) => s + rowNum(row, k), 0)
            : (['user_compute', 'other_compute', 'k8s', 'other_overhead'] as const).filter(k => !cloudCostsToggle.isHidden(k)).reduce((s, k) => s + rowNum(row, k), 0)
  ));
  const cloudPctSeriesStats: SeriesStats = cloudView === 'user_compute'
    ? { ...Object.fromEntries(userComputeProducts.map(p => [p, computeStats(cloudPctRows.map(row => rowNum(row, p)))])), ...(userComputeHasOther ? { '(Other)': computeStats(cloudPctRows.map(row => rowNum(row, '(Other)'))) } : {}) }
    : cloudView === 'other_compute'
      ? { batch_test: computeStats(cloudPctRows.map(row => rowNum(row, 'batch_test'))), batch_dev: computeStats(cloudPctRows.map(row => rowNum(row, 'batch_dev'))), unknown: computeStats(cloudPctRows.map(row => rowNum(row, 'unknown'))) }
      : cloudView === 'k8s'
        ? { k8s_nodes: computeStats(cloudPctRows.map(row => rowNum(row, 'k8s_nodes'))), k8s_mgmt: computeStats(cloudPctRows.map(row => rowNum(row, 'k8s_mgmt'))) }
        : cloudView === 'other_overhead'
          ? Object.fromEntries(overheadServices.map(svc => [svc, computeStats(cloudPctRows.map(row => rowNum(row, svc)))]))
          : { user_compute: computeStats(cloudPctRows.map(row => rowNum(row, 'user_compute'))), other_compute: computeStats(cloudPctRows.map(row => rowNum(row, 'other_compute'))), k8s: computeStats(cloudPctRows.map(row => rowNum(row, 'k8s'))), other_overhead: computeStats(cloudPctRows.map(row => rowNum(row, 'other_overhead'))) };

  const billingPctRows = billingChartData as Record<string, unknown>[];
  const billingPctStats = computeStats(billingPctRows.map(row =>
    billingView === 'resource_usage'
      ? [...billingResources.filter(r => !isBillingResourceHidden(r)), ...(billingResourcesHasOther && !isBillingResourceHidden('(Other)') ? ['(Other)'] : [])].reduce((s, k) => s + rowNum(row, k), 0)
      : (['resource_cost', 'service_fees'] as const).filter(k => !billingToggle.isHidden(k)).reduce((s, k) => s + rowNum(row, k), 0)
  ));
  const billingPctSeriesStats: SeriesStats = billingView === 'resource_usage'
    ? { ...Object.fromEntries(billingResources.map(r => [r, computeStats(billingPctRows.map(row => rowNum(row, r)))])), ...(billingResourcesHasOther ? { '(Other)': computeStats(billingPctRows.map(row => rowNum(row, '(Other)'))) } : {}) }
    : { resource_cost: computeStats(billingPctRows.map(row => rowNum(row, 'resource_cost'))), service_fees: computeStats(billingPctRows.map(row => rowNum(row, 'service_fees'))) };

  const profitStats = computeStats(trendData.map(d => d.profit));
  const coreHoursData = useMemo(() => trendData.map(d => ({ month: d.month, core_hours: d.service_fees * 100 })), [trendData]);
  const coreHoursStats = useMemo(() => computeStats(coreHoursData.map(d => d.core_hours)), [coreHoursData]);
  const coreHoursExtent = Math.max(0, ...coreHoursData.map(d => d.core_hours));

  const customRatioValues = useMemo(
    () => trendData.map(d => {
      const den = resolveTrend(customRatioDen, d);
      return den === 0 ? null : (resolveTrend(customRatioNum, d) / den) * 100;
    }),
    [trendData, customRatioNum, customRatioDen]
  );
  const customRatioStats = useMemo(
    () => computeStats(customRatioValues.filter((v): v is number => v !== null)),
    [customRatioValues]
  );
  const customRatioChartData = useMemo(
    () => trendData.map((d, i) => ({ month: d.month, value: customRatioValues[i] })),
    [trendData, customRatioValues]
  );
  const scatterChartData = useMemo(
    () => trendData.map(d => ({ month: d.month, x: resolveTrend(scatterX, d), y: resolveTrend(scatterY, d) })),
    [trendData, scatterX, scatterY]
  );
  const scatterRegression = useMemo(() => computeRegression(scatterChartData), [scatterChartData]);
  const regressionLineData = useMemo(() => {
    if (!scatterRegression || scatterChartData.length < 2) return [];
    const xs = scatterChartData.map(d => d.x);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    return [
      { x: xMin, y: scatterRegression.slope * xMin + scatterRegression.intercept },
      { x: xMax, y: scatterRegression.slope * xMax + scatterRegression.intercept },
    ];
  }, [scatterRegression, scatterChartData]);

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

  useEffect(() => {
    if (!compareTimePeriod) {
      setCompareCloudCosts(null);
      setCompareUserBilling(null);
      setCompareCloudError(null);
      setCompareBillingError(null);
      return;
    }
    setCompareLoading(true);
    setCompareCloudCosts(null);
    setCompareUserBilling(null);
    setCompareCloudError(null);
    setCompareBillingError(null);
    Promise.allSettled([
      fetchCloudCosts(monitoringBaseUrl, compareTimePeriod),
      fetchUserBilling(batchBaseUrl, compareTimePeriod),
    ]).then(([cloudResult, billingResult]) => {
      if (cloudResult.status === 'fulfilled') setCompareCloudCosts(cloudResult.value);
      else setCompareCloudError(cloudResult.reason instanceof Error ? cloudResult.reason.message : 'Failed to load cloud costs.');
      if (billingResult.status === 'fulfilled') setCompareUserBilling(billingResult.value);
      else setCompareBillingError(billingResult.reason instanceof Error ? billingResult.reason.message : 'Failed to load user billing.');
      setCompareLoading(false);
    });
  }, [compareTimePeriod, monitoringBaseUrl, batchBaseUrl]);

  useEffect(() => {
    if (tab !== 'trends') return;
    setTrendsLoading(true);
    const now = new Date();
    const months: string[] = [];
    for (let i = 12; i >= 1; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`);
    }
    Promise.all(
      months.map(async (m) => {
        const [cloud, billing] = await Promise.allSettled([
          fetchCloudCosts(monitoringBaseUrl, m),
          fetchUserBilling(batchBaseUrl, m),
        ]);
        const c = cloud.status === 'fulfilled' ? cloud.value : null;
        const b = billing.status === 'fulfilled' ? billing.value : null;
        const overhead = c ? c.other_compute + c.other_overhead : 0;
        return {
          month: monthParamToLabel(m),
          cloud_total: c?.total ?? 0,
          user_compute: c?.user_compute ?? 0,
          other_compute: c?.other_compute ?? 0,
          other_overhead: c?.other_overhead ?? 0,
          batch_test: c?.batch_test ?? 0,
          batch_dev: c?.batch_dev ?? 0,
          unknown: c?.unknown ?? 0,
          k8s: c?.k8s ?? 0,
          k8s_nodes: c?.k8s_nodes ?? 0,
          k8s_mgmt: c?.k8s_mgmt ?? 0,
          non_compute_services: c?.non_compute_services ?? {},
          user_compute_by_product: c?.user_compute_by_product ?? {},
          resource_by_type: b?.resource_by_type ?? {},
          user_billing: b?.total ?? 0,
          service_fees: b?.service_fee_cost ?? 0,
          resource_cost: b?.resource_cost ?? 0,
          profit: (b?.total ?? 0) - (c?.total ?? 0),
          svc_fee_overhead_pct: c && b && overhead > 0 ? (b.service_fee_cost / overhead) * 100 : null,
          resource_billing_pct: c && b && c.user_compute > 0 ? (b.resource_cost / c.user_compute) * 100 : null,
          svc_fee_bill_pct: b && b.total > 0 ? (b.service_fee_cost / b.total) * 100 : null,
          overhead_cloud_pct: c && c.total > 0 ? (overhead / c.total) * 100 : null,
          overhead_resource_pct: b && b.resource_cost > 0 ? (overhead / b.resource_cost) * 100 : null,
        };
      })
    ).then(points => {
      setTrendData(points);
      setTrendsLoading(false);
    });
  }, [tab, monitoringBaseUrl, batchBaseUrl]);

  const renderCloudBody = (
    costs: CloudCosts | null,
    err: string | null,
    ldg: boolean,
    period: string,
    compact: boolean,
  ) => {
    if (err) return <p className="text-red-500 text-sm py-2">{err}</p>;
    if (!costs) return ldg ? null : <p className="text-zinc-400 text-sm py-2">No data for {period}.</p>;

    const mProducts = Object.entries(costs.user_compute_by_product)
      .filter(([, v]) => v >= 10).sort(([, a], [, b]) => b - a).map(([p]) => p);
    const hasOtherP = Object.values(costs.user_compute_by_product).some(v => v < 10);
    const ucOtherCost = Object.entries(costs.user_compute_by_product)
      .filter(([p]) => !mProducts.includes(p)).reduce((s, [, v]) => s + v, 0);
    const overheadSvcsSorted = Object.entries(costs.non_compute_services)
      .sort(([, a], [, b]) => b - a).map(([s]) => s);

    const rows = (() => {
      if (cloudView === 'summary') return (
        <>
          {([
            { label: 'User-driven compute', value: costs.user_compute },
            { label: 'Other compute', value: costs.other_compute },
            { label: 'K8s', value: costs.k8s },
            { label: 'Other overhead', value: costs.other_overhead },
          ] as const).slice().sort((a, b) => b.value - a.value).map(r => (
            <CostRow key={r.label} label={r.label} value={r.value} pctStr={pct(r.value, costs.total)} />
          ))}
          <CostRow label="Total" value={costs.total} bold />
        </>
      );
      if (cloudView === 'user_compute') return (
        <>
          {mProducts.map(p => (
            <CostRow key={p} label={p} value={costs.user_compute_by_product[p] ?? 0} pctStr={pct(costs.user_compute_by_product[p] ?? 0, costs.user_compute)} indent />
          ))}
          {hasOtherP && ucOtherCost > 0 && <CostRow label="(Other)" value={ucOtherCost} pctStr={pct(ucOtherCost, costs.user_compute)} indent />}
          <CostRow label="User-driven compute total" value={costs.user_compute} bold />
        </>
      );
      if (cloudView === 'other_compute') return (
        <>
          {([
            { label: 'CI / test batches', value: costs.batch_test },
            { label: 'Dev batches', value: costs.batch_dev },
            { label: 'Unknown / unlabeled', value: costs.unknown },
          ] as const).slice().sort((a, b) => b.value - a.value).map(r => (
            <CostRow key={r.label} label={r.label} value={r.value} pctStr={pct(r.value, costs.other_compute)} indent />
          ))}
          <CostRow label="Other compute total" value={costs.other_compute} bold />
        </>
      );
      if (cloudView === 'k8s') return (
        <>
          {([
            { label: 'Compute nodes', value: costs.k8s_nodes },
            { label: 'Management fee', value: costs.k8s_mgmt },
          ] as const).slice().sort((a, b) => b.value - a.value).map(r => (
            <CostRow key={r.label} label={r.label} value={r.value} pctStr={pct(r.value, costs.k8s)} indent />
          ))}
          <CostRow label="K8s total" value={costs.k8s} bold />
        </>
      );
      return (
        <>
          {overheadSvcsSorted.map(svc => (
            <CostRow key={svc} label={svc} value={costs.non_compute_services[svc] ?? 0} pctStr={pct(costs.non_compute_services[svc] ?? 0, costs.other_overhead)} indent />
          ))}
          <CostRow label="Other overhead total" value={costs.other_overhead} bold />
        </>
      );
    })();

    const pieData: PieSlice[] = (() => {
      if (cloudView === 'summary') return [
        { name: 'User-driven compute', value: costs.user_compute, fill: '#0ea5e9' },
        { name: 'Other compute', value: costs.other_compute, fill: '#f59e0b' },
        { name: 'K8s', value: costs.k8s, fill: '#10b981' },
        { name: 'Other overhead', value: costs.other_overhead, fill: '#8b5cf6' },
      ];
      if (cloudView === 'user_compute') return [
        ...mProducts.map((p, i) => ({ name: p, value: costs.user_compute_by_product[p] ?? 0, fill: USER_COMPUTE_PALETTE[i % USER_COMPUTE_PALETTE.length] })),
        ...(hasOtherP ? [{ name: '(Other)', value: ucOtherCost, fill: '#9ca3af' }] : []),
      ];
      if (cloudView === 'other_compute') return [
        { name: 'CI / test batches', value: costs.batch_test, fill: '#f59e0b' },
        { name: 'Dev batches', value: costs.batch_dev, fill: '#fcd34d' },
        { name: 'Unknown / unlabeled', value: costs.unknown, fill: '#fef3c7' },
      ];
      if (cloudView === 'k8s') return [
        { name: 'Compute nodes', value: costs.k8s_nodes, fill: '#059669' },
        { name: 'Management fee', value: costs.k8s_mgmt, fill: '#6ee7b7' },
      ];
      return overheadSvcsSorted.map((svc, i) => ({ name: svc, value: costs.non_compute_services[svc] ?? 0, fill: OVERHEAD_PALETTE[i % OVERHEAD_PALETTE.length] }));
    })();

    return (
      <div className="flex items-center gap-4">
        <div className="flex-1">{rows}</div>
        <div className={`${compact ? 'w-28' : 'w-40'} flex-shrink-0`}>
          <MiniPieChart data={pieData} size={compact ? 'sm' : 'md'} />
        </div>
      </div>
    );
  };

  const renderBillingBody = (
    billing: UserBilling | null,
    err: string | null,
    ldg: boolean,
    period: string,
    compact: boolean,
  ) => {
    if (err) return <p className="text-amber-600 text-sm py-2">{err}</p>;
    if (!billing) return ldg ? null : <p className="text-zinc-400 text-sm py-2">No data for {period}.</p>;

    const mResources = Object.entries(billing.resource_by_type)
      .filter(([, v]) => v >= 10).sort(([, a], [, b]) => b - a).map(([r]) => r);
    const hasOtherR = Object.values(billing.resource_by_type).some(v => v < 10);
    const brOtherCost = Object.entries(billing.resource_by_type)
      .filter(([r]) => !mResources.includes(r)).reduce((s, [, v]) => s + v, 0);

    const rows = billingView === 'summary' ? (
      <>
        <CostRow label="Resource usage" value={billing.resource_cost} pctStr={pct(billing.resource_cost, billing.total)} />
        <CostRow label="Service fees" value={billing.service_fee_cost} pctStr={pct(billing.service_fee_cost, billing.total)} />
        <CostRow label="Total" value={billing.total} bold />
      </>
    ) : (
      <>
        {mResources.map(r => (
          <CostRow key={r} label={r} value={billing.resource_by_type[r] ?? 0} pctStr={pct(billing.resource_by_type[r] ?? 0, billing.resource_cost)} indent />
        ))}
        {hasOtherR && brOtherCost > 0 && <CostRow label="(Other)" value={brOtherCost} pctStr={pct(brOtherCost, billing.resource_cost)} indent />}
        <CostRow label="Resource usage total" value={billing.resource_cost} bold />
      </>
    );

    const pieData: PieSlice[] = billingView === 'summary'
      ? [
          { name: 'Resource usage', value: billing.resource_cost, fill: '#10b981' },
          { name: 'Service fees', value: billing.service_fee_cost, fill: '#6ee7b7' },
        ]
      : [
          ...mResources.map((r, i) => ({ name: r, value: billing.resource_by_type[r] ?? 0, fill: BILLING_RESOURCE_PALETTE[i % BILLING_RESOURCE_PALETTE.length] })),
          ...(hasOtherR ? [{ name: '(Other)', value: brOtherCost, fill: '#9ca3af' }] : []),
        ];

    return (
      <div className="flex items-center gap-4">
        <div className="flex-1">{rows}</div>
        <div className={`${compact ? 'w-28' : 'w-40'} flex-shrink-0`}>
          <MiniPieChart data={pieData} size={compact ? 'sm' : 'md'} />
        </div>
      </div>
    );
  };

  const renderMarginBody = (costs: CloudCosts | null, billing: UserBilling | null) => {
    if (!costs || !billing) return <p className="text-zinc-400 text-sm py-2">No data.</p>;
    const netVal = billing.total - costs.total;
    return (
      <>
        <CostRow label="Net (billed − cloud)" value={netVal} bold colorClass={netVal >= 0 ? 'text-emerald-600' : 'text-red-600'} />
        <div className="flex justify-between py-2 border-b border-zinc-100">
          <span className="text-zinc-700 font-semibold">Margin %</span>
          <span className={`tabular-nums font-semibold ${netVal >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{pct(netVal, costs.total)}</span>
        </div>
      </>
    );
  };

  const renderFixedRatios = (costs: CloudCosts | null, billing: UserBilling | null) => {
    if (!costs || !billing) return <p className="text-zinc-400 text-sm py-2">No data.</p>;
    return (
      <>
        <RatioRow label="User compute as % of cloud" value={pct(costs.user_compute, costs.total)} />
        <RatioRow label="Resource billing as % of user-driven compute" value={pct(billing.resource_cost, costs.user_compute)} />
        <RatioRow label="Service fees as % of user billing" value={pct(billing.service_fee_cost, billing.total)} />
        <RatioRow label="Service fees as % of overhead" value={pct(billing.service_fee_cost, costs.other_compute + costs.other_overhead)} />
      </>
    );
  };

  const net = userBilling && cloudCosts ? userBilling.total - cloudCosts.total : null;

  const tabClass = (t: typeof tab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t
      ? 'border-sky-500 text-sky-600'
      : 'border-transparent text-zinc-500 hover:text-zinc-700'}`;

  return (
    <div className="px-4 py-6 space-y-6">
      <h1 className="text-2xl font-light text-zinc-800">Cost Analysis</h1>

      <div className="flex border-b border-zinc-200">
        <button className={tabClass('monthly')} onClick={() => changeTab('monthly')}>Monthly Breakdown</button>
        <button className={tabClass('trends')} onClick={() => changeTab('trends')}>Trends</button>
      </div>

      {tab === 'monthly' && (
        <>
          {compareTimePeriod !== null ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <button onClick={() => setTimePeriod(p => shiftMonthParam(p, -1))} className="px-2 py-1 text-sm border border-zinc-300 rounded hover:bg-zinc-100">‹</button>
                <input
                  type="month"
                  className="border border-zinc-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                  value={monthParamToInputValue(timePeriod)}
                  onChange={e => { if (e.target.value) setTimePeriod(inputValueToMonthParam(e.target.value)); }}
                />
                <button onClick={() => setTimePeriod(p => shiftMonthParam(p, 1))} className="px-2 py-1 text-sm border border-zinc-300 rounded hover:bg-zinc-100">›</button>
                {loading && <span className="text-xs text-zinc-400 animate-pulse">Loading…</span>}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setCompareTimePeriod(p => shiftMonthParam(p!, -1))} className="px-2 py-1 text-sm border border-zinc-300 rounded hover:bg-zinc-100">‹</button>
                <input
                  type="month"
                  className="border border-zinc-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                  value={monthParamToInputValue(compareTimePeriod)}
                  onChange={e => { if (e.target.value) setCompareTimePeriod(inputValueToMonthParam(e.target.value)); }}
                />
                <button onClick={() => setCompareTimePeriod(p => shiftMonthParam(p!, 1))} className="px-2 py-1 text-sm border border-zinc-300 rounded hover:bg-zinc-100">›</button>
                {compareLoading && <span className="text-xs text-zinc-400 animate-pulse">Loading…</span>}
                <button
                  onClick={() => setCompareTimePeriod(null)}
                  className="ml-1 p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"
                  title="Remove comparison"
                >
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <label className="text-sm text-zinc-500">Month</label>
              <button onClick={() => setTimePeriod(p => shiftMonthParam(p, -1))} className="px-2 py-1 text-sm border border-zinc-300 rounded hover:bg-zinc-100">‹</button>
              <input
                type="month"
                className="border border-zinc-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                value={monthParamToInputValue(timePeriod)}
                onChange={e => { if (e.target.value) setTimePeriod(inputValueToMonthParam(e.target.value)); }}
              />
              <button onClick={() => setTimePeriod(p => shiftMonthParam(p, 1))} className="px-2 py-1 text-sm border border-zinc-300 rounded hover:bg-zinc-100">›</button>
              {loading && <span className="text-xs text-zinc-400 animate-pulse">Loading…</span>}
              <button
                onClick={() => setCompareTimePeriod(shiftMonthParam(timePeriod, -1))}
                className="ml-2 flex items-center gap-1.5 text-sm text-sky-600 hover:text-sky-700 border border-sky-200 hover:border-sky-400 rounded px-3 py-1.5 bg-sky-50 hover:bg-sky-100 transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                Add month to compare
              </button>
            </div>
          )}

          <Panel title="Cloud Costs" viewSelector={
            <select
              className="text-xs border border-zinc-300 rounded px-2 py-1 bg-white text-zinc-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
              value={cloudView}
              onChange={e => setCloudView(e.target.value as typeof cloudView)}
            >
              <option value="summary">Summary</option>
              <option value="user_compute">User-driven compute</option>
              <option value="other_compute">Other compute</option>
              <option value="k8s">K8s</option>
              <option value="other_overhead">Other overhead</option>
            </select>
          }>
            {compareTimePeriod !== null ? (
              <div className="grid grid-cols-2 divide-x divide-zinc-100">
                <div className="pr-4">{renderCloudBody(cloudCosts, cloudError, loading, timePeriod, true)}</div>
                <div className="pl-4">{renderCloudBody(compareCloudCosts, compareCloudError, compareLoading, compareTimePeriod, true)}</div>
              </div>
            ) : renderCloudBody(cloudCosts, cloudError, loading, timePeriod, false)}
          </Panel>

          <Panel title="User Billing" viewSelector={
            <select
              className="text-xs border border-zinc-300 rounded px-2 py-1 bg-white text-zinc-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
              value={billingView}
              onChange={e => setBillingView(e.target.value as typeof billingView)}
            >
              <option value="summary">Summary</option>
              <option value="resource_usage">Resource usage</option>
            </select>
          }>
            {compareTimePeriod !== null ? (
              <div className="grid grid-cols-2 divide-x divide-zinc-100">
                <div className="pr-4">{renderBillingBody(userBilling, billingError, loading, timePeriod, true)}</div>
                <div className="pl-4">{renderBillingBody(compareUserBilling, compareBillingError, compareLoading, compareTimePeriod, true)}</div>
              </div>
            ) : renderBillingBody(userBilling, billingError, loading, timePeriod, false)}
          </Panel>

          {(userBilling || compareTimePeriod !== null) && (
            <Panel title="Usage">
              {compareTimePeriod !== null ? (
                <div className="grid grid-cols-2 divide-x divide-zinc-100">
                  <div className="pr-4">
                    {userBilling
                      ? <RatioRow label="Core hours" value={fmtCoreHours(userBilling.service_fee_cost * 100)} />
                      : <p className="text-zinc-400 text-sm py-2">—</p>}
                  </div>
                  <div className="pl-4">
                    {compareUserBilling
                      ? <RatioRow label="Core hours" value={fmtCoreHours(compareUserBilling.service_fee_cost * 100)} />
                      : <p className="text-zinc-400 text-sm py-2">—</p>}
                  </div>
                </div>
              ) : (
                userBilling && <RatioRow label="Core hours" value={fmtCoreHours(userBilling.service_fee_cost * 100)} />
              )}
            </Panel>
          )}

          {(net !== null || compareTimePeriod !== null) && (
            <>
              <Panel title="Margin Analysis">
                {compareTimePeriod !== null ? (
                  <div className="grid grid-cols-2 divide-x divide-zinc-100">
                    <div className="pr-4">{renderMarginBody(cloudCosts, userBilling)}</div>
                    <div className="pl-4">{renderMarginBody(compareCloudCosts, compareUserBilling)}</div>
                  </div>
                ) : (
                  net !== null && cloudCosts && userBilling && renderMarginBody(cloudCosts, userBilling)
                )}
              </Panel>
              <Panel title="Ratios">
                {compareTimePeriod !== null ? (
                  <>
                    <div className="grid grid-cols-2 divide-x divide-zinc-100">
                      <div className="pr-4">{renderFixedRatios(cloudCosts, userBilling)}</div>
                      <div className="pl-4">{renderFixedRatios(compareCloudCosts, compareUserBilling)}</div>
                    </div>
                    <div className="border-t border-zinc-100 pt-1 mt-1">
                      <CustomRatioPicker fieldGroups={fieldGroups} num={customRatioNum} den={customRatioDen} onNumChange={setCustomRatioNum} onDenChange={setCustomRatioDen} />
                      <div className="grid grid-cols-2 divide-x divide-zinc-100">
                        <div className="pr-4">
                          <RatioRow
                            label={`${fieldLabel(customRatioNum, fieldGroups)} as % of ${fieldLabel(customRatioDen, fieldGroups)}`}
                            value={cloudCosts && userBilling ? pct(resolveMonthly(customRatioNum, cloudCosts, userBilling), resolveMonthly(customRatioDen, cloudCosts, userBilling)) : '—'}
                          />
                        </div>
                        <div className="pl-4">
                          <RatioRow
                            label={`${fieldLabel(customRatioNum, fieldGroups)} as % of ${fieldLabel(customRatioDen, fieldGroups)}`}
                            value={compareCloudCosts && compareUserBilling ? pct(resolveMonthly(customRatioNum, compareCloudCosts, compareUserBilling), resolveMonthly(customRatioDen, compareCloudCosts, compareUserBilling)) : '—'}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  net !== null && cloudCosts && userBilling && (
                    <>
                      {renderFixedRatios(cloudCosts, userBilling)}
                      <div className="border-t border-zinc-100 pt-1">
                        <CustomRatioPicker fieldGroups={fieldGroups} num={customRatioNum} den={customRatioDen} onNumChange={setCustomRatioNum} onDenChange={setCustomRatioDen} />
                        <RatioRow
                          label={`${fieldLabel(customRatioNum, fieldGroups)} as % of ${fieldLabel(customRatioDen, fieldGroups)}`}
                          value={pct(resolveMonthly(customRatioNum, cloudCosts, userBilling), resolveMonthly(customRatioDen, cloudCosts, userBilling))}
                        />
                      </div>
                    </>
                  )
                )}
              </Panel>
            </>
          )}
        </>
      )}

      {tab === 'trends' && (
        trendsLoading ? (
          <p className="text-zinc-400 text-sm py-4 text-center animate-pulse">Loading…</p>
        ) : (
          <div>
            <Panel title="Cloud Costs" collapsible viewSelector={
              <div className="flex items-center gap-3">
                <ToggleSwitch checked={cloudShowPct} onChange={setCloudShowPct} />
                <select
                  className="text-xs border border-zinc-300 rounded px-2 py-1 bg-white text-zinc-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  value={cloudView}
                  onChange={e => setCloudView(e.target.value as typeof cloudView)}
                >
                  <option value="summary">Summary</option>
                  <option value="user_compute">User-driven compute</option>
                  <option value="other_compute">Other compute</option>
                  <option value="k8s">K8s</option>
                  <option value="other_overhead">Other overhead</option>
                </select>
              </div>
            }>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={cloudChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis
                    tickFormatter={cloudShowPct ? (v => `${v.toFixed(0)}%`) : makeYDollarFormatter(cloudYMax)}
                    tick={{ fontSize: 11 }}
                    width={56}
                    domain={cloudShowPct ? [0, 100] : [0, cloudYMax]}
                  />
                  <Tooltip content={(p) => <ChartTooltip {...p} stats={cloudShowPct ? cloudPctStats : cloudStats} seriesStats={cloudShowPct ? cloudPctSeriesStats : cloudSeriesStats} format={cloudShowPct ? (v => `${v.toFixed(1)}%`) : fmt} stacked />} />
                  {cloudView === 'summary' ? (
                    <>
                      <Legend onClick={cloudCostsToggle.onLegendClick} wrapperStyle={{ cursor: 'pointer' }} />
                      {statsReferenceLines(cloudShowPct ? cloudPctStats : cloudStats, 0, cloudShowPct ? 100 : cloudYMax)}
                      <Bar dataKey="user_compute" name="User-driven compute" stackId="a" fill="#0ea5e9" hide={cloudCostsToggle.isHidden('user_compute')} />
                      <Bar dataKey="other_compute" name="Other compute" stackId="a" fill="#f59e0b" hide={cloudCostsToggle.isHidden('other_compute')} />
                      <Bar dataKey="k8s" name="K8s" stackId="a" fill="#10b981" hide={cloudCostsToggle.isHidden('k8s')} />
                      <Bar dataKey="other_overhead" name="Other overhead" stackId="a" fill="#8b5cf6" hide={cloudCostsToggle.isHidden('other_overhead')} />
                    </>
                  ) : cloudView === 'user_compute' ? (
                    <>
                      <Legend onClick={onUserComputeLegendClick} wrapperStyle={{ cursor: 'pointer' }} />
                      {statsReferenceLines(cloudShowPct ? cloudPctStats : cloudStats, 0, cloudShowPct ? 100 : cloudYMax)}
                      {userComputeProducts.map(p => (
                        <Bar key={p} dataKey={p} name={p} stackId="a" fill={userComputeProductColor(p)} hide={isUserComputeHidden(p)} />
                      ))}
                      {userComputeHasOther && <Bar dataKey="(Other)" name="(Other)" stackId="a" fill="#9ca3af" hide={isUserComputeHidden('(Other)')} />}
                    </>
                  ) : cloudView === 'other_compute' ? (
                    <>
                      <Legend onClick={otherComputeToggle.onLegendClick} wrapperStyle={{ cursor: 'pointer' }} />
                      {statsReferenceLines(cloudShowPct ? cloudPctStats : cloudStats, 0, cloudShowPct ? 100 : cloudYMax)}
                      <Bar dataKey="batch_test" name="CI / test batches" stackId="a" fill="#f59e0b" hide={otherComputeToggle.isHidden('batch_test')} />
                      <Bar dataKey="batch_dev" name="Dev batches" stackId="a" fill="#fcd34d" hide={otherComputeToggle.isHidden('batch_dev')} />
                      <Bar dataKey="unknown" name="Unknown / unlabeled" stackId="a" fill="#fef3c7" hide={otherComputeToggle.isHidden('unknown')} />
                    </>
                  ) : cloudView === 'k8s' ? (
                    <>
                      <Legend onClick={k8sToggle.onLegendClick} wrapperStyle={{ cursor: 'pointer' }} />
                      {statsReferenceLines(cloudShowPct ? cloudPctStats : cloudStats, 0, cloudShowPct ? 100 : cloudYMax)}
                      <Bar dataKey="k8s_nodes" name="Compute nodes" stackId="a" fill="#059669" hide={k8sToggle.isHidden('k8s_nodes')} />
                      <Bar dataKey="k8s_mgmt" name="Management fee" stackId="a" fill="#6ee7b7" hide={k8sToggle.isHidden('k8s_mgmt')} />
                    </>
                  ) : (
                    <>
                      <Legend onClick={onOverheadLegendClick} wrapperStyle={{ cursor: 'pointer' }} />
                      {statsReferenceLines(cloudShowPct ? cloudPctStats : cloudStats, 0, cloudShowPct ? 100 : cloudYMax)}
                      {overheadServices.map(svc => (
                        <Bar key={svc} dataKey={svc} name={svc} stackId="a" fill={overheadServiceColor(svc)} hide={isOverheadHidden(svc)} />
                      ))}
                    </>
                  )}
                </BarChart>
              </ResponsiveContainer>
              <StatsDisplay stats={cloudShowPct ? cloudPctStats : cloudStats} format={cloudShowPct ? (v => `${v.toFixed(1)}%`) : fmt} />
            </Panel>

            <div className="h-10" />
            <Panel title="Billing Charges" collapsible viewSelector={
              <div className="flex items-center gap-3">
                <ToggleSwitch checked={billingShowPct} onChange={setBillingShowPct} />
                <select
                  className="text-xs border border-zinc-300 rounded px-2 py-1 bg-white text-zinc-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  value={billingView}
                  onChange={e => setBillingView(e.target.value as typeof billingView)}
                >
                  <option value="summary">Summary</option>
                  <option value="resource_usage">Resource usage</option>
                </select>
              </div>
            }>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={billingChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis
                    tickFormatter={billingShowPct ? (v => `${v.toFixed(0)}%`) : makeYDollarFormatter(billingYMax)}
                    tick={{ fontSize: 11 }}
                    width={56}
                    domain={billingShowPct ? [0, 100] : [0, billingYMax]}
                  />
                  <Tooltip content={(p) => <ChartTooltip {...p} stats={billingShowPct ? billingPctStats : billingStats} seriesStats={billingShowPct ? billingPctSeriesStats : billingSeriesStats} format={billingShowPct ? (v => `${v.toFixed(1)}%`) : fmt} stacked />} />
                  {billingView === 'summary' ? (
                    <>
                      <Legend onClick={billingToggle.onLegendClick} wrapperStyle={{ cursor: 'pointer' }} />
                      {statsReferenceLines(billingShowPct ? billingPctStats : billingStats, 0, billingShowPct ? 100 : billingYMax)}
                      <Bar dataKey="resource_cost" name="Resource charges" stackId="a" fill="#10b981" hide={billingToggle.isHidden('resource_cost')} />
                      <Bar dataKey="service_fees" name="Service fees" stackId="a" fill="#6ee7b7" hide={billingToggle.isHidden('service_fees')} />
                    </>
                  ) : (
                    <>
                      <Legend onClick={onBillingResourceLegendClick} wrapperStyle={{ cursor: 'pointer' }} />
                      {statsReferenceLines(billingShowPct ? billingPctStats : billingStats, 0, billingShowPct ? 100 : billingYMax)}
                      {billingResources.map(r => (
                        <Bar key={r} dataKey={r} name={r} stackId="a" fill={billingResourceColor(r)} hide={isBillingResourceHidden(r)} />
                      ))}
                      {billingResourcesHasOther && <Bar dataKey="(Other)" name="(Other)" stackId="a" fill="#9ca3af" hide={isBillingResourceHidden('(Other)')} />}
                    </>
                  )}
                </BarChart>
              </ResponsiveContainer>
              <StatsDisplay stats={billingShowPct ? billingPctStats : billingStats} format={billingShowPct ? (v => `${v.toFixed(1)}%`) : fmt} />
            </Panel>

            <div className="h-10" />
            <Panel title="Profit" collapsible>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={makeYDollarFormatter(profitYExtent)} tick={{ fontSize: 11 }} width={56} />
                  <Tooltip content={(p) => <ChartTooltip {...p} stats={profitStats} format={fmt} />} />
                  <ReferenceLine y={0} stroke="#52525b" strokeWidth={1.5} />
                  {statsReferenceLines(profitStats, -Infinity, Infinity)}
                  <Bar dataKey="profit" name="Profit">
                    {trendData.map((d, i) => <Cell key={i} fill={d.profit >= 0 ? '#10b981' : '#ef4444'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <StatsDisplay stats={profitStats} format={fmt} />
            </Panel>

            <div className="h-10" />
            <Panel title="Usage" collapsible>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={coreHoursData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => fmtCoreHours(v)} tick={{ fontSize: 11 }} width={56} domain={[0, coreHoursExtent]} />
                  <Tooltip content={(p) => <ChartTooltip {...p} stats={coreHoursStats} format={fmtCoreHours} />} />
                  {statsReferenceLines(coreHoursStats, 0, Infinity)}
                  <Bar dataKey="core_hours" name="Core hours" fill="#818cf8" />
                </BarChart>
              </ResponsiveContainer>
              <StatsDisplay stats={coreHoursStats} format={fmtCoreHours} />
            </Panel>

            <div className="h-10" />
            <Panel title="Ratios" collapsible>
              <PresetChips
                presets={RATIO_PRESETS}
                activeNum={customRatioNum}
                activeDen={customRatioDen}
                onSelect={(num, den) => { setCustomRatioNum(num); setCustomRatioDen(den); }}
              />
              <CustomRatioPicker fieldGroups={fieldGroups} num={customRatioNum} den={customRatioDen} onNumChange={setCustomRatioNum} onDenChange={setCustomRatioDen} />
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={customRatioChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => `${v.toFixed(0)}%`} tick={{ fontSize: 11 }} width={48} domain={[0, 'auto']} />
                  <Tooltip content={(p) => <ChartTooltip {...p} stats={customRatioStats} format={v => `${v.toFixed(1)}%`} />} />
                  {statsReferenceLines(customRatioStats, -Infinity, Infinity)}
                  <Bar dataKey="value" name={`${fieldLabel(customRatioNum, fieldGroups)} as % of ${fieldLabel(customRatioDen, fieldGroups)}`} fill="#22d3ee" />
                </BarChart>
              </ResponsiveContainer>
              <StatsDisplay stats={customRatioStats} format={v => `${v.toFixed(1)}%`} />
            </Panel>

            <div className="h-10" />
            <Panel title="Scatter Plot" collapsible>
              <ScatterPresetChips
                presets={SCATTER_PRESETS}
                activeX={scatterX}
                activeY={scatterY}
                onSelect={(x, y) => { setScatterX(x); setScatterY(y); }}
              />
              <div className="flex items-center gap-2 py-2 flex-wrap">
                <span className="text-xs text-zinc-500 shrink-0">X axis:</span>
                <select
                  className="text-xs border border-zinc-300 rounded px-2 py-1 bg-white text-zinc-600 focus:outline-none focus:ring-2 focus:ring-sky-400 flex-1 min-w-0"
                  value={scatterX}
                  onChange={e => setScatterX(e.target.value)}
                >
                  {fieldGroups.map(g => (
                    <optgroup key={g.group} label={g.group}>
                      {g.fields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </optgroup>
                  ))}
                </select>
                <span className="text-xs text-zinc-500 shrink-0">Y axis:</span>
                <select
                  className="text-xs border border-zinc-300 rounded px-2 py-1 bg-white text-zinc-600 focus:outline-none focus:ring-2 focus:ring-sky-400 flex-1 min-w-0"
                  value={scatterY}
                  onChange={e => setScatterY(e.target.value)}
                >
                  {fieldGroups.map(g => (
                    <optgroup key={g.group} label={g.group}>
                      {g.fields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </optgroup>
                  ))}
                </select>
                <ToggleSwitch checked={showRegression} onChange={setShowRegression} label="regression line" />
              </div>
              {(() => {
                const fmtDollar = (v: number) => Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`;
                const fmtPct = (v: number) => `${v.toFixed(1)}%`;
                const fieldFmt = (id: string) => id === 'margin/margin_pct' ? fmtPct : id === 'derived/core_hours' ? fmtCoreHours : fmtDollar;
                const fmtX = fieldFmt(scatterX);
                const fmtY = fieldFmt(scatterY);
                return <>
              <ResponsiveContainer width="100%" height={320}>
                <ScatterChart margin={{ top: 16, right: 32, left: 0, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name={fieldLabel(scatterX, fieldGroups)}
                    tickFormatter={fmtX}
                    tick={{ fontSize: 11 }}
                    label={{ value: fieldLabel(scatterX, fieldGroups), position: 'insideBottom', offset: -8, fontSize: 11, fill: '#71717a' }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name={fieldLabel(scatterY, fieldGroups)}
                    tickFormatter={fmtY}
                    tick={{ fontSize: 11 }}
                    width={56}
                  />
                  <ZAxis range={[40, 40]} />
                  <Tooltip
                    content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0].payload as { month: string; x: number; y: number };
                      return (
                        <div className="rounded border border-zinc-200 bg-white px-3 py-2 text-xs shadow">
                          <div className="font-semibold text-zinc-700 mb-1">{d.month}</div>
                          <div className="text-zinc-500">{fieldLabel(scatterX, fieldGroups)}: <span className="text-zinc-800 font-medium">{fmtX(d.x)}</span></div>
                          <div className="text-zinc-500">{fieldLabel(scatterY, fieldGroups)}: <span className="text-zinc-800 font-medium">{fmtY(d.y)}</span></div>
                        </div>
                      );
                    }}
                  />
                  <Scatter
                    data={scatterChartData}
                    fill="#0ea5e9"
                    shape={(props: { cx?: number; cy?: number; payload?: { month: string } }) => {
                      const { cx = 0, cy = 0, payload } = props;
                      return (
                        <g>
                          <circle cx={cx} cy={cy} r={5} fill="#0ea5e9" fillOpacity={0.85} />
                          <text x={cx + 7} y={cy + 4} fontSize={10} fill="#52525b">{payload?.month}</text>
                        </g>
                      );
                    }}
                  />
                  {showRegression && regressionLineData.length === 2 && (
                    <Scatter
                      data={regressionLineData}
                      line={{ stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '6 3' }}
                      shape={() => <g />}
                      legendType="none"
                      tooltipType="none"
                      isAnimationActive={false}
                    />
                  )}
                </ScatterChart>
              </ResponsiveContainer>
                  <RegressionStatsDisplay
                    reg={scatterRegression}
                    xLabel={fieldLabel(scatterX, fieldGroups)}
                    yLabel={fieldLabel(scatterY, fieldGroups)}
                    fmtX={fmtX}
                    fmtY={fmtY}
                  />
                </>;
              })()}
            </Panel>
          </div>
        )
      )}

      {tab === 'trends' && (
        <div className="mt-6 flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          <span className="mt-0.5 shrink-0 text-sky-400">ℹ</span>
          <span>
            <strong>Chart legend:</strong> click a series name to isolate it; click again to restore all.
            Hold <kbd className="rounded border border-sky-300 bg-white px-1 py-0.5 font-mono text-xs">Shift</kbd> and click to toggle a series on or off individually.
          </span>
        </div>
      )}
    </div>
  );
}
