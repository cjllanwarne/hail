export function fmtDollars(v: number | null): string {
  if (v === null || v === undefined) return 'Unlimited';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtCost(v: number): string {
  if (v === 0) return '$0';
  if (v < 0.0001) return '<$0.0001';
  return '$' + v.toFixed(4);
}
