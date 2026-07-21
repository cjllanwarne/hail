export interface BillingProject {
  billing_project: string;
  status: string;
  users: string[];
  limit: number | null;
  quote_id: number;
  quote_name: string;
  low_budget_alert: number | null;
  remaining: number | null;
  accrued_cost: number;
}

export interface QuoteManager {
  user: string;
  role: string;
}

export interface Quote {
  id: number;
  name: string;
  cost_object: string;
  authorized_amount: number | null;
  pi_name: string | null;
  pm_designee: string | null;
  time_created: string;
  managers: QuoteManager[];
  billing_projects: BillingProject[];
}

export interface BillingEvent {
  id: number;
  timestamp: string;
  actor: string;
  action: string;
  target_user: string | null;
  target_project?: string | null;
  detail: string | null;
  comment: string | null;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, { credentials: 'same-origin' });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}${text ? ': ' + text : ''}`);
  }
  return resp.json() as Promise<T>;
}

export async function apiCall(method: string, url: string, body?: object): Promise<void> {
  const resp = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}${text ? ': ' + text : ''}`);
  }
}
