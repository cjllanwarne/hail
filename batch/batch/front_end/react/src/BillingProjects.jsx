import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

function BillingProjects({ basePath, csrfToken }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [editingRow, setEditingRow] = useState(null);

  async function fetchProjects() {
    try {
      const resp = await fetch(`${basePath}/api/v1alpha/billing_projects`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setProjects(data);
    } catch (e) {
      setMessage({ text: `Error loading billing projects: ${e.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchProjects();
  }, []);

  async function apiPost(url, body) {
    const opts = {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(basePath + url, opts);
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || `HTTP ${resp.status}`);
    }
    return resp;
  }

  async function handleEditLimit(bp, limit) {
    try {
      await apiPost(`/api/v1alpha/billing_limits/${bp}/edit`, { limit: Number(limit) });
      setEditingRow(null);
      setMessage({ text: `Modified limit for billing project ${bp}.`, type: 'info' });
      await fetchProjects();
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    }
  }

  async function handleRemoveUser(bp, user) {
    try {
      await apiPost(`/api/v1alpha/billing_projects/${bp}/users/${user}/remove`);
      setMessage({ text: `Removed user ${user} from billing project ${bp}.`, type: 'info' });
      await fetchProjects();
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    }
  }

  async function handleAddUser(bp, user) {
    try {
      await apiPost(`/api/v1alpha/billing_projects/${bp}/users/${encodeURIComponent(user)}/add`);
      setMessage({ text: `Added user ${user} to billing project ${bp}.`, type: 'info' });
      await fetchProjects();
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    }
  }

  async function handleClose(bp) {
    try {
      await apiPost(`/api/v1alpha/billing_projects/${bp}/close`);
      setEditingRow(null);
      setMessage({ text: `Closed billing project ${bp}.`, type: 'info' });
      await fetchProjects();
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    }
  }

  async function handleReopen(bp) {
    try {
      await apiPost(`/api/v1alpha/billing_projects/${bp}/reopen`);
      setMessage({ text: `Reopened billing project ${bp}.`, type: 'info' });
      await fetchProjects();
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    }
  }

  async function handleCreate(name) {
    try {
      await apiPost(`/api/v1alpha/billing_projects/${encodeURIComponent(name)}/create`);
      setMessage({ text: `Created billing project ${name}.`, type: 'info' });
      await fetchProjects();
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    }
  }

  const openProjects = projects.filter((p) => p.status === 'open');
  const closedProjects = projects.filter((p) => p.status === 'closed');

  if (loading) {
    return (
      <div className="flex items-center gap-2 mt-4 text-slate-500">
        <svg className="animate-spin h-5 w-5 text-sky-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Loading...
      </div>
    );
  }

  const messageClasses = message?.type === 'error'
    ? 'text-red-700 border border-red-400 bg-red-50 px-3 py-2 rounded mb-4 w-fit'
    : 'text-green-700 border border-green-400 bg-green-50 px-3 py-2 rounded mb-4 w-fit';

  return (
    <>
      {message && (
        <div className={`${messageClasses} flex justify-between items-center`}>
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} className="ml-4 hover:opacity-70">
            <span className="material-symbols-outlined">check</span>
          </button>
        </div>
      )}
      <CreateForm onCreate={handleCreate} />
      <table className="table-fixed overflow-hidden rounded mt-4">
      <thead>
        <tr>
          <th className="h-16 bg-slate-200 font-normal pl-2 text-left rounded-tl">Billing Project</th>
          <th className="h-16 bg-slate-200 font-normal text-left">Limit</th>
          <th className="h-16 bg-slate-200 font-normal text-left">Users</th>
          <th className="h-16 bg-slate-200 font-normal text-left rounded-tr"></th>
        </tr>
      </thead>
      <tbody>
        {openProjects.map((bp) => (
          <OpenProjectRow
            key={bp.billing_project}
            bp={bp}
            editing={editingRow === bp.billing_project}
            onEdit={() => setEditingRow(bp.billing_project)}
            onCancel={() => setEditingRow(null)}
            onEditLimit={handleEditLimit}
            onRemoveUser={handleRemoveUser}
            onAddUser={handleAddUser}
            onClose={handleClose}
          />
        ))}
        {closedProjects.map((bp) => (
          <ClosedProjectRow key={bp.billing_project} bp={bp} onReopen={handleReopen} />
        ))}
      </tbody>
    </table>
    </>
  );
}

function CreateForm({ onCreate }) {
  const [name, setName] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (name.trim()) {
      onCreate(name.trim());
      setName('');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        className="border rounded-sm p-1"
        type="text"
        spellCheck="false"
        autoCorrect="off"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className="border border-gray-200 bg-gray-50 hover:bg-slate-400 hover:text-white px-2 py-1 rounded-md">
        Create
      </button>
    </form>
  );
}

function OpenProjectRow({ bp, editing, onEdit, onCancel, onEditLimit, onRemoveUser, onAddUser, onClose }) {
  const [limitInput, setLimitInput] = useState(bp.limit);
  const [newUser, setNewUser] = useState('');

  useEffect(() => {
    setLimitInput(bp.limit);
  }, [bp.limit]);

  function submitLimit(e) {
    e.preventDefault();
    onEditLimit(bp.billing_project, limitInput);
  }

  function submitAddUser(e) {
    e.preventDefault();
    if (newUser.trim()) {
      onAddUser(bp.billing_project, newUser.trim());
      setNewUser('');
    }
  }

  return (
    <tr className="border border-collapse hover:bg-slate-100">
      <td className="p-2">{bp.billing_project}</td>
      <td className="p-2">
        <form onSubmit={submitLimit}>
          <input
            className="border rounded-sm w-28"
            type="number"
            required
            disabled={!editing}
            value={limitInput ?? ''}
            onChange={(e) => setLimitInput(e.target.value)}
          />
          {editing && (
            <div className="pt-2">
              <button
                type="submit"
                className="border border-gray-200 bg-gray-50 hover:bg-slate-400 hover:text-white px-2 py-1 rounded-md"
              >
                Update
              </button>
            </div>
          )}
        </form>
      </td>
      <td className="p-2">
        <div className="flex-col">
          {bp.users.map((user) => (
            <div
              key={user}
              className={`group flex justify-between items-top p-0.5 rounded-sm${editing ? '' : ' hover:bg-slate-200 hover:cursor-pointer'}`}
            >
              <div>{user}</div>
              {editing && (
                <div className="invisible group-hover:visible">
                  <button
                    type="button"
                    className="hover:bg-slate-300 rounded-sm flex align-middle"
                    onClick={() => onRemoveUser(bp.billing_project, user)}
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
              )}
            </div>
          ))}
          {editing && (
            <form onSubmit={submitAddUser}>
              <input
                type="text"
                spellCheck="false"
                autoCorrect="off"
                className="border rounded-sm w-28 mr-1"
                value={newUser}
                onChange={(e) => setNewUser(e.target.value)}
              />
              <button
                type="submit"
                className="border border-gray-200 bg-gray-50 hover:bg-slate-400 hover:text-white px-2 py-1 rounded-md"
              >
                Add
              </button>
            </form>
          )}
        </div>
      </td>
      <td className="flex-col justify-center items-center">
        {!editing ? (
          <div className="flex justify-center">
            <button onClick={onEdit} className="hover:bg-slate-300 rounded p-1 flex align-middle">
              <span className="material-symbols-outlined">edit</span>
            </button>
          </div>
        ) : (
          <div className="flex-col justify-around items-center space-y-1">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onClose(bp.billing_project);
              }}
            >
              <button
                type="submit"
                className="border border-red-200 bg-red-50 hover:bg-red-700 hover:text-white px-2 py-1 rounded-md"
              >
                Close
              </button>
            </form>
            <button
              type="button"
              onClick={onCancel}
              className="border border-gray-200 bg-gray-50 hover:bg-slate-400 hover:text-white px-2 py-1 rounded-md"
            >
              Cancel
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function ClosedProjectRow({ bp, onReopen }) {
  return (
    <tr className="border border-collapse bg-gray-100">
      <td className="p-2 font-thin italic">{bp.billing_project}</td>
      <td className="p-2 font-thin">{bp.limit}</td>
      <td></td>
      <td className="px-4">
        <button
          type="button"
          className="border border-gray-200 bg-gray-50 hover:bg-slate-400 hover:text-white px-2 py-1 rounded-md"
          onClick={() => onReopen(bp.billing_project)}
        >
          Reopen
        </button>
      </td>
    </tr>
  );
}

const mountEl = document.getElementById('billing-projects-root');
if (mountEl) {
  const basePath = mountEl.dataset.basePath || '';
  const csrfToken = document.head.querySelector('meta[name="csrf"]')?.getAttribute('value') || '';
  createRoot(mountEl).render(<BillingProjects basePath={basePath} csrfToken={csrfToken} />);
}
