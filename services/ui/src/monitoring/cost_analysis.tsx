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

function useLegendToggle() {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const onLegendClick = useCallback((e: { dataKey?: string | number | ((obj: unknown) => unknown) }) => {
    if (typeof e.dataKey !== 'string') return;
    const key = e.dataKey;
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const isHidden = (key: string) => hidden.has(key);
  return { onLegendClick, isHidden };
}

// --- Main component ---

interface CostAnalysisProps { monitoringBaseUrl: string; batchBaseUrl: string }

export function CostAnalysis({ monitoringBaseUrl, batchBaseUrl }: CostAnalysisProps) {
  const [tab, setTab] = useState<'monthly' | 'trends'>('monthly');
  const costsToggle = useLegendToggle();
  const ratiosToggle = useLegendToggle();
  const [timePeriod, setTimePeriod] = useState(currentMonthParam());
  const [cloudCosts, setCloudCosts] = useState<CloudCosts | null>(null);
  const [userBilling, setUserBilling] = useState<UserBilling | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [trendData, setTrendData] = useState<MonthDataPoint[]>([]);
  const [trendsLoading, setTrendsLoading] = useState(false);

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
    for (let i = 11; i >= 0; i--) {
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
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <h1 className="text-2xl font-light text-zinc-800">Cost Analysis</h1>

      <div className="flex border-b border-zinc-200">
        <button className={tabClass('monthly')} onClick={() => setTab('monthly')}>Monthly Breakdown</button>
        <button className={tabClass('trends')} onClick={() => setTab('trends')}>Trends</button>
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
          <div className="space-y-6">
            <Panel title="Costs">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} width={56} />
                  <Tooltip formatter={(v) => typeof v === 'number' ? fmt(v) : ''} />
                  <Legend onClick={costsToggle.onLegendClick} wrapperStyle={{ cursor: 'pointer' }} />
                  <ReferenceLine y={0} stroke="#52525b" strokeWidth={1.5} />
                  <Bar dataKey="user_compute" name="User-driven compute" stackId="costs" fill="#0ea5e9" hide={costsToggle.isHidden('user_compute')} />
                  <Bar dataKey="other_compute" name="Other compute" stackId="costs" fill="#7dd3fc" hide={costsToggle.isHidden('other_compute')} />
                  <Bar dataKey="other_overhead" name="Other overhead" stackId="costs" fill="#bae6fd" hide={costsToggle.isHidden('other_overhead')} />
                  <Bar dataKey="resource_cost" name="Resource charges" stackId="billing" fill="#10b981" hide={costsToggle.isHidden('resource_cost')} />
                  <Bar dataKey="service_fees" name="Service fees" stackId="billing" fill="#6ee7b7" hide={costsToggle.isHidden('service_fees')} />
                  <Bar dataKey="profit" name="Profit" hide={costsToggle.isHidden('profit')}>
                    {trendData.map((d, i) => <Cell key={i} fill={d.profit >= 0 ? '#10b981' : '#ef4444'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Ratios">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => `${v.toFixed(0)}%`} tick={{ fontSize: 11 }} width={48} />
                  <Tooltip formatter={(v) => typeof v === 'number' ? `${v.toFixed(1)}%` : ''} />
                  <Legend onClick={ratiosToggle.onLegendClick} wrapperStyle={{ cursor: 'pointer' }} />
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
            </Panel>
          </div>
        )
      )}
    </div>
  );
}
