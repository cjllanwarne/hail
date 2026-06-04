import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

// --- Types ---

interface CloudCosts {
  user_compute: number;
  other_compute: number;
  other_overhead: number;
  total: number;
}

interface BillingRow {
  resource: string;
  cost: number;
}

interface UserBilling {
  total: number;
  resource_cost: number;
  service_fee_cost: number;
}

interface MonthDataPoint {
  month: string;
  cloud_total: number;
  user_compute: number;
  other_compute: number;
  other_overhead: number;
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

// --- API fetchers ---

async function fetchCloudCosts(monitoringBaseUrl: string, period: string): Promise<CloudCosts> {
  const resp = await fetch(`${monitoringBaseUrl}/api/v1alpha/billing?time_period=${encodeURIComponent(period)}`);
  if (!resp.ok) throw new Error(`Cloud billing fetch failed (HTTP ${resp.status})`);
  const data = await resp.json();

  const breakdown: { source: string; cost: string }[] = data['compute_cost_breakdown'] ?? [];
  const byService: { service: string; cost: string }[] = data['cost_by_service'] ?? [];

  const costs: CloudCosts = { user_compute: 0, other_compute: 0, other_overhead: 0, total: 0 };
  let computeTotal = 0;
  for (const row of breakdown) {
    const cost = parseCostStr(row.cost);
    computeTotal += cost;
    if (row.source === 'batch-production') costs.user_compute += cost;
    else if (row.source === 'k8s') costs.other_overhead += cost;
    else costs.other_compute += cost;
  }
  const cloudTotal = byService.reduce((sum, row) => sum + parseCostStr(row.cost), 0);
  costs.other_overhead += Math.max(0, cloudTotal - computeTotal);
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
  for (const row of rows) {
    total += row.cost;
    if (row.resource.startsWith('service-fee')) service_fee_cost += row.cost;
  }
  return { total, resource_cost: total - service_fee_cost, service_fee_cost };
}

// --- Components ---

interface PanelProps { title: string; subtitle?: string; collapsible?: boolean; children: React.ReactNode }
function Panel({ title, subtitle, collapsible = false, children }: PanelProps) {
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
        <div>
          <h2 className="text-base font-semibold text-zinc-800">{title}</h2>
          {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
        </div>
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

interface PieSlice { name: string; value: number; fill: string }
function MiniPieChart({ data }: { data: PieSlice[] }) {
  return (
    <ResponsiveContainer width="100%" height={156}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={42} outerRadius={64} dataKey="value" paddingAngle={2}>
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
  const cloudCostsToggle = useLegendToggle(['user_compute', 'other_compute', 'other_overhead'] as const);
  const billingToggle = useLegendToggle(['resource_cost', 'service_fees'] as const);
  const RATIO_KEYS = ['svc_fee_overhead_pct', 'resource_billing_pct', 'svc_fee_bill_pct', 'overhead_cloud_pct', 'overhead_resource_pct'] as const;
  const ratiosToggle = useLegendToggle(RATIO_KEYS);
  const [timePeriod, setTimePeriod] = useState(currentMonthParam());
  const [cloudCosts, setCloudCosts] = useState<CloudCosts | null>(null);
  const [userBilling, setUserBilling] = useState<UserBilling | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [trendData, setTrendData] = useState<MonthDataPoint[]>([]);
  const [trendsLoading, setTrendsLoading] = useState(false);

  const cloudYMax = Math.max(
    0,
    ...trendData.map(d =>
      (cloudCostsToggle.isHidden('user_compute') ? 0 : d.user_compute) +
      (cloudCostsToggle.isHidden('other_compute') ? 0 : d.other_compute) +
      (cloudCostsToggle.isHidden('other_overhead') ? 0 : d.other_overhead)
    ),
  );
  const billingYMax = Math.max(
    0,
    ...trendData.map(d =>
      (billingToggle.isHidden('resource_cost') ? 0 : d.resource_cost) +
      (billingToggle.isHidden('service_fees') ? 0 : d.service_fees)
    ),
  );

  const cloudStats = computeStats(trendData.map(d =>
    (cloudCostsToggle.isHidden('user_compute') ? 0 : d.user_compute) +
    (cloudCostsToggle.isHidden('other_compute') ? 0 : d.other_compute) +
    (cloudCostsToggle.isHidden('other_overhead') ? 0 : d.other_overhead)
  ));
  const cloudSeriesStats: SeriesStats = {
    user_compute: computeStats(trendData.map(d => d.user_compute)),
    other_compute: computeStats(trendData.map(d => d.other_compute)),
    other_overhead: computeStats(trendData.map(d => d.other_overhead)),
  };
  const billingStats = computeStats(trendData.map(d =>
    (billingToggle.isHidden('resource_cost') ? 0 : d.resource_cost) +
    (billingToggle.isHidden('service_fees') ? 0 : d.service_fees)
  ));
  const billingSeriesStats: SeriesStats = {
    resource_cost: computeStats(trendData.map(d => d.resource_cost)),
    service_fees: computeStats(trendData.map(d => d.service_fees)),
  };
  const profitStats = computeStats(trendData.map(d => d.profit));
  const soloRatioKeys = RATIO_KEYS.filter(k => !ratiosToggle.isHidden(k));
  const ratioStats = soloRatioKeys.length === 1
    ? computeStats(trendData.map(d => d[soloRatioKeys[0]]).filter((v): v is number => v !== null))
    : null;
  const ratioSeriesStats: SeriesStats = Object.fromEntries(
    RATIO_KEYS.map(k => [k, computeStats(trendData.map(d => d[k]).filter((v): v is number => v !== null))])
  );

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
          </div>

          <Panel title="Cloud Costs">
            {cloudError ? (
              <p className="text-red-500 text-sm py-2">{cloudError}</p>
            ) : cloudCosts ? (
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <CostRow label="User-driven compute" value={cloudCosts.user_compute} pctStr={pct(cloudCosts.user_compute, cloudCosts.total)} />
                  <CostRow label="Other compute" value={cloudCosts.other_compute} pctStr={pct(cloudCosts.other_compute, cloudCosts.total)} />
                  <CostRow label="Other overhead" value={cloudCosts.other_overhead} pctStr={pct(cloudCosts.other_overhead, cloudCosts.total)} />
                  <CostRow label="Total" value={cloudCosts.total} bold />
                </div>
                <div className="w-40 flex-shrink-0">
                  <MiniPieChart data={[
                    { name: 'User-driven compute', value: cloudCosts.user_compute, fill: '#0ea5e9' },
                    { name: 'Other compute', value: cloudCosts.other_compute, fill: '#7dd3fc' },
                    { name: 'Other overhead', value: cloudCosts.other_overhead, fill: '#bae6fd' },
                  ]} />
                </div>
              </div>
            ) : !loading && <p className="text-zinc-400 text-sm py-2">No data for {timePeriod}.</p>}
          </Panel>

          <Panel title="User Billing">
            {billingError ? (
              <p className="text-amber-600 text-sm py-2">{billingError}</p>
            ) : userBilling ? (
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <CostRow label="Resource usage" value={userBilling.resource_cost} pctStr={pct(userBilling.resource_cost, userBilling.total)} />
                  <CostRow label="Service fees" value={userBilling.service_fee_cost} pctStr={pct(userBilling.service_fee_cost, userBilling.total)} />
                  <CostRow label="Total" value={userBilling.total} bold />
                </div>
                <div className="w-40 flex-shrink-0">
                  <MiniPieChart data={[
                    { name: 'Resource usage', value: userBilling.resource_cost, fill: '#10b981' },
                    { name: 'Service fees', value: userBilling.service_fee_cost, fill: '#6ee7b7' },
                  ]} />
                </div>
              </div>
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
              <RatioRow label="User compute as % of cloud" value={pct(cloudCosts.user_compute, cloudCosts.total)} />
              <RatioRow label="Resource billing as % of user-driven compute" value={pct(userBilling.resource_cost, cloudCosts.user_compute)} />
              <RatioRow label="Service fees as % of user billing" value={pct(userBilling.service_fee_cost, userBilling.total)} />
              <RatioRow label="Service fees as % of overhead" value={pct(userBilling.service_fee_cost, cloudCosts.other_compute + cloudCosts.other_overhead)} />
            </Panel>
          )}
        </>
      )}

      {tab === 'trends' && (
        trendsLoading ? (
          <p className="text-zinc-400 text-sm py-4 text-center animate-pulse">Loading…</p>
        ) : (
          <div>
            <Panel title="Cloud Costs" collapsible>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} width={56} domain={[0, cloudYMax]} />
                  <Tooltip content={(p) => <ChartTooltip {...p} stats={cloudStats} seriesStats={cloudSeriesStats} format={fmt} stacked />} />
                  <Legend onClick={cloudCostsToggle.onLegendClick} wrapperStyle={{ cursor: 'pointer' }} />
                  {statsReferenceLines(cloudStats, 0, cloudYMax)}
                  <Bar dataKey="user_compute" name="User-driven compute" stackId="a" fill="#0ea5e9" hide={cloudCostsToggle.isHidden('user_compute')} />
                  <Bar dataKey="other_compute" name="Other compute" stackId="a" fill="#7dd3fc" hide={cloudCostsToggle.isHidden('other_compute')} />
                  <Bar dataKey="other_overhead" name="Other overhead" stackId="a" fill="#bae6fd" hide={cloudCostsToggle.isHidden('other_overhead')} />
                </BarChart>
              </ResponsiveContainer>
              <StatsDisplay stats={cloudStats} format={fmt} />
            </Panel>

            <div className="h-10" />
            <Panel title="Billing Charges" collapsible>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} width={56} domain={[0, billingYMax]} />
                  <Tooltip content={(p) => <ChartTooltip {...p} stats={billingStats} seriesStats={billingSeriesStats} format={fmt} stacked />} />
                  <Legend onClick={billingToggle.onLegendClick} wrapperStyle={{ cursor: 'pointer' }} />
                  {statsReferenceLines(billingStats, 0, billingYMax)}
                  <Bar dataKey="resource_cost" name="Resource charges" stackId="a" fill="#10b981" hide={billingToggle.isHidden('resource_cost')} />
                  <Bar dataKey="service_fees" name="Service fees" stackId="a" fill="#6ee7b7" hide={billingToggle.isHidden('service_fees')} />
                </BarChart>
              </ResponsiveContainer>
              <StatsDisplay stats={billingStats} format={fmt} />
            </Panel>

            <div className="h-10" />
            <Panel title="Profit" collapsible>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} width={56} />
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
            <Panel title="Ratios" collapsible>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => `${v.toFixed(0)}%`} tick={{ fontSize: 11 }} width={48} domain={[0, 'auto']} />
                  <Tooltip content={(p) => <ChartTooltip {...p} stats={ratioStats} seriesStats={ratioSeriesStats} format={v => `${v.toFixed(1)}%`} />} />
                  <Legend onClick={ratiosToggle.onLegendClick} wrapperStyle={{ cursor: 'pointer' }} />
                  {statsReferenceLines(ratioStats, -Infinity, Infinity)}
                  <ReferenceLine y={100} stroke="#52525b" strokeWidth={1.5} />
                  <ReferenceLine y={75} stroke="#d4d4d8" strokeWidth={1} strokeDasharray="4 3" />
                  <ReferenceLine y={50} stroke="#d4d4d8" strokeWidth={1} strokeDasharray="4 3" />
                  <ReferenceLine y={25} stroke="#d4d4d8" strokeWidth={1} strokeDasharray="4 3" />
                  <Bar dataKey="svc_fee_overhead_pct" name="Service fees as % of overhead" fill="#f59e0b" hide={ratiosToggle.isHidden('svc_fee_overhead_pct')} />
                  <Bar dataKey="resource_billing_pct" name="Resource billing as % of user-driven compute" fill="#0ea5e9" hide={ratiosToggle.isHidden('resource_billing_pct')} />
                  <Bar dataKey="svc_fee_bill_pct" name="Service fees as % of user bill" fill="#a78bfa" hide={ratiosToggle.isHidden('svc_fee_bill_pct')} />
                  <Bar dataKey="overhead_cloud_pct" name="Overhead as % of cloud costs" fill="#f87171" hide={ratiosToggle.isHidden('overhead_cloud_pct')} />
                  <Bar dataKey="overhead_resource_pct" name="Overhead as % of user-driven resource costs" fill="#fb923c" hide={ratiosToggle.isHidden('overhead_resource_pct')} />
                </BarChart>
              </ResponsiveContainer>
              <StatsDisplay stats={ratioStats} format={v => `${v.toFixed(1)}%`} />
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
