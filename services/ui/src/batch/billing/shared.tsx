import { useState } from 'react';
import type { ReactNode } from 'react';
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

export interface ConfirmModalProps {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: (comment: string) => Promise<void>;
  onClose: () => void;
}

export function ConfirmModal({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onClose }: ConfirmModalProps) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(comment);
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
      <div className="bg-white rounded shadow-lg w-full max-w-md p-6">
        <h2 className="text-xl font-light mb-2">{title}</h2>
        {message && <p className="text-sm text-slate-600 mb-4">{message}</p>}
        <div className="mb-4">
          <label className="block text-sm text-slate-600 mb-1">Comment <span className="text-slate-400">(optional)</span></label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            className="border rounded px-2 py-1 w-full text-sm resize-none"
            placeholder="Reason for this action…"
            autoFocus
          />
        </div>
        {error && <div className="text-red-600 text-xs mb-3">{error}</div>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="border border-gray-300 px-3 py-1.5 rounded text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={submitting}
            className={`text-white px-4 py-1.5 rounded text-sm disabled:opacity-50 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {submitting ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface EventLogColumn {
  key: keyof BillingEvent;
  label: string;
  render?: (value: BillingEvent[keyof BillingEvent], event: BillingEvent) => ReactNode;
}

export function EventLog({ events, columns }: { events: BillingEvent[]; columns: EventLogColumn[] }) {
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
              {columns.map((c) => {
                const val = e[c.key];
                return (
                  <td key={c.key} className="p-2 text-slate-700">
                    {c.render ? c.render(val, e) : String(val ?? '')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
