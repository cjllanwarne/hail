import { useState } from 'react';
import type { BillingEvent } from './api';

export function SectionHeader({ label }: { label: string }) {
  return (
    <div className="bg-slate-100 px-4 py-2 font-medium text-sm uppercase tracking-wide text-slate-600 rounded-t">
      {label}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm mb-4">
      {message}
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="text-slate-500 hover:text-slate-700 flex items-center gap-1 text-sm">
      <span className="material-symbols-outlined text-base">arrow_back</span>
      {label}
    </a>
  );
}

interface EditableRowProps {
  label: string;
  value: string;
  displayValue?: string;
  canEdit: boolean;
  inputType?: 'text' | 'number';
  placeholder?: string;
  onSave: (val: string) => Promise<void>;
}

export function EditableRow({ label, value, displayValue, canEdit, inputType = 'text', placeholder, onSave }: EditableRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="border-b border-slate-100 group">
      <td className="py-2 pl-4 pr-8 text-slate-500 w-40 align-middle">{label}</td>
      <td className="py-2 align-middle">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type={inputType}
              min={inputType === 'number' ? '0' : undefined}
              step={inputType === 'number' ? '0.01' : undefined}
              className="border rounded px-2 py-1 w-40 text-sm"
              value={draft}
              placeholder={placeholder}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => { setEditing(false); setDraft(value); setError(null); }}
              className="text-slate-500 hover:text-slate-700 text-sm"
            >
              Cancel
            </button>
          </div>
        ) : (
          <span>{displayValue ?? (value || '—')}</span>
        )}
        {error && <div className="text-red-600 text-xs mt-1">{error}</div>}
      </td>
      <td className="py-2 pr-4 text-right align-middle w-10">
        {canEdit && !editing && (
          <button
            onClick={() => { setDraft(value); setEditing(true); setError(null); }}
            className="hover:bg-slate-200 rounded p-0.5 opacity-0 group-hover:opacity-100"
          >
            <span className="material-symbols-outlined text-base">edit</span>
          </button>
        )}
      </td>
    </tr>
  );
}

export function EventLog({ events, columns }: {
  events: BillingEvent[];
  columns: { key: keyof BillingEvent; label: string }[];
}) {
  if (events.length === 0) {
    return <p className="p-4 text-sm text-slate-500">No events yet.</p>;
  }
  return (
    <div className="overflow-auto max-h-96">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="text-left p-2 font-medium">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-t hover:bg-slate-50">
              {columns.map((c) => (
                <td key={c.key} className={`p-2 ${c.key === 'timestamp' ? 'whitespace-nowrap text-slate-500' : c.key === 'detail' ? 'text-slate-600' : ''}`}>
                  {String(e[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
