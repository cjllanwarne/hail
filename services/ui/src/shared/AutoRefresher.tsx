interface Props {
  autoRefresh: boolean;
  onToggle: (v: boolean) => void;
  refreshing: boolean;
  countdownKey: number;
  intervalMs: number;
  trackColor?: string;
}

const KEYFRAMES = `@keyframes countdown-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }`;

export function AutoRefresher({ autoRefresh, onToggle, refreshing, countdownKey, intervalMs, trackColor }: Props): JSX.Element {
  return (
    <>
      <style>{KEYFRAMES}</style>
      <div>
        <label className="flex items-center gap-1.5 text-zinc-500 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => { onToggle(e.target.checked); }}
            className="cursor-pointer"
          />
          Auto-refresh
          {autoRefresh && refreshing && (
            <span className="material-symbols-outlined text-sm animate-spin text-sky-400" style={{ animationDuration: '1s' }}>
              progress_activity
            </span>
          )}
        </label>
        <div
          className="mt-1.5 h-0.5 bg-zinc-200 rounded-full overflow-hidden"
          style={trackColor ? { background: trackColor } : undefined}
        >
          {autoRefresh && !refreshing && (
            <div
              key={countdownKey}
              className="h-full bg-sky-400 origin-left"
              style={{ animation: `countdown-grow ${intervalMs}ms linear forwards` }}
            />
          )}
          {autoRefresh && refreshing && (
            <div className="h-full bg-sky-300 w-full animate-pulse" />
          )}
        </div>
      </div>
    </>
  );
}
