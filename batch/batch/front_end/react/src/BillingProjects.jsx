import { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-sky-600 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );
}

function BillingProjects({ basePath, csrfToken }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [editingRow, setEditingRow] = useState(null);
  const [pendingCreate, setPendingCreate] = useState(null);
  const [highlightedProject, setHighlightedProject] = useState(null);

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

  function highlight(name) {
    setHighlightedProject(name);
    setTimeout(() => setHighlightedProject(null), 2000);
  }

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

  async function handleCreate(name, limit, users) {
    setPendingCreate({ name });
    try {
      await apiPost(`/api/v1alpha/billing_projects/${encodeURIComponent(name)}/create`, {
        limit: limit !== '' ? Number(limit) : null,
        users,
      });
      setMessage({ text: `Created billing project ${name}.`, type: 'info' });
      highlight(name);
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    } finally {
      setPendingCreate(null);
      await fetchProjects();
    }
  }

  async function handleEditLimit(bp, limit) {
    try {
      await apiPost(`/api/v1alpha/billing_limits/${bp}/edit`, { limit: Number(limit) });
      setEditingRow(null);
      setMessage({ text: `Modified limit for billing project ${bp}.`, type: 'info' });
      highlight(bp);
      await fetchProjects();
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    }
  }

  async function handleRemoveUser(bp, user) {
    try {
      await apiPost(`/api/v1alpha/billing_projects/${bp}/users/${user}/remove`);
      setMessage({ text: `Removed user ${user} from billing project ${bp}.`, type: 'info' });
      highlight(bp);
      await fetchProjects();
    } catch (e) {
      setMessage({ text: e.message, type: 'error' });
    }
  }

  async function handleAddUser(bp, user) {
    try {
      await apiPost(`/api/v1alpha/billing_projects/${bp}/users/${encodeURIComponent(user)}/add`);
      setMessage({ text: `Added user ${user} to billing project ${bp}.`, type: 'info' });
      highlight(bp);
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
      highlight(bp);
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
          <button type="button" onClick={() => setMessage(null)} className="ml-4 text-sm hover:opacity-70 underline">
            Dismiss
          </button>
        </div>
      )}
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
          <CreateRow onCreate={handleCreate} />
          {pendingCreate && <PendingRow name={pendingCreate.name} />}
          {openProjects.map((bp) => (
            <OpenProjectRow
              key={bp.billing_project}
              bp={bp}
              editing={editingRow === bp.billing_project}
              highlighted={highlightedProject === bp.billing_project}
              onEdit={() => setEditingRow(bp.billing_project)}
              onCancel={() => setEditingRow(null)}
              onEditLimit={handleEditLimit}
              onRemoveUser={handleRemoveUser}
              onAddUser={handleAddUser}
              onClose={handleClose}
            />
          ))}
          {closedProjects.map((bp) => (
            <ClosedProjectRow
              key={bp.billing_project}
              bp={bp}
              highlighted={highlightedProject === bp.billing_project}
              onReopen={handleReopen}
            />
          ))}
        </tbody>
      </table>
    </>
  );
}

function CreateRow({ onCreate }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState('');

  function addUser() {
    const trimmed = newUser.trim();
    if (trimmed && !users.includes(trimmed)) {
      setUsers([...users, trimmed]);
      setNewUser('');
    }
  }

  function handleCreate() {
    if (!name.trim()) return;
    const allUsers = [...users];
    const pendingUser = newUser.trim();
    if (pendingUser && !allUsers.includes(pendingUser)) allUsers.push(pendingUser);
    const snapshot = { name: name.trim(), limit, users: allUsers };
    setName(''); setLimit(''); setUsers([]); setNewUser(''); setOpen(false);
    onCreate(snapshot.name, snapshot.limit, snapshot.users);
  }

  function handleCancel() {
    setName(''); setLimit(''); setUsers([]); setNewUser(''); setOpen(false);
  }

  return (
    <tr className="border border-collapse bg-sky-50">
      {!open && (
        <>
          <td className="p-2 h-20 align-middle">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex items-center gap-1 border border-gray-200 bg-gray-50 hover:bg-slate-400 hover:text-white px-2 py-1 rounded-md"
            >
              Create Project
              <span className="material-symbols-outlined text-base">chevron_right</span>
            </button>
          </td>
          <td></td><td></td><td></td>
        </>
      )}
      {open && (<>
        <td className="p-2">
          <input
            className="border rounded-sm p-1 w-full"
            type="text"
            spellCheck="false"
            autoCorrect="off"
            placeholder="Project name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreate(); } }}
          />
        </td>
        <td className="p-2">
          <input
            className="border rounded-sm w-28 p-1"
            type="number"
            placeholder="No limit"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </td>
        <td className="p-2">
          <div className="flex flex-col gap-0.5">
            {users.map((user) => (
              <div key={user} className="group flex items-center gap-1">
                <span className="text-sm">{user}</span>
                <button
                  type="button"
                  onClick={() => setUsers(users.filter((u) => u !== user))}
                  className="invisible group-hover:visible hover:bg-slate-300 rounded-sm flex"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>
            ))}
            <div className="flex gap-1 mt-0.5">
              <input
                type="text"
                spellCheck="false"
                autoCorrect="off"
                className="border rounded-sm p-1 w-28"
                placeholder="Add user..."
                value={newUser}
                onChange={(e) => setNewUser(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addUser(); } }}
              />
              <button
                type="button"
                onClick={addUser}
                className="border border-gray-200 bg-gray-50 hover:bg-slate-400 hover:text-white px-2 py-1 rounded-md"
              >
                Add
              </button>
            </div>
          </div>
        </td>
        <td className="p-2">
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={handleCreate}
              className="border border-gray-200 bg-gray-50 hover:bg-slate-400 hover:text-white px-2 py-1 rounded-md"
            >
              Create
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="border border-gray-200 bg-gray-50 hover:bg-slate-400 hover:text-white px-2 py-1 rounded-md"
            >
              Cancel
            </button>
          </div>
        </td>
      </>)}
    </tr>
  );
}

function PendingRow({ name }) {
  return (
    <tr className="border border-collapse">
      <td className="p-2">
        <div className="flex items-center gap-2 text-slate-500">
          <Spinner />
          {name}
        </div>
      </td>
      <td></td><td></td><td></td>
    </tr>
  );
}

function OpenProjectRow({ bp, editing, highlighted, onEdit, onCancel, onEditLimit, onRemoveUser, onAddUser, onClose }) {
  const [limitInput, setLimitInput] = useState(bp.limit);
  const [newUser, setNewUser] = useState('');
  const [flashBg, setFlashBg] = useState(false);
  const [flashTransition, setFlashTransition] = useState(false);
  const rowRef = useRef(null);

  useEffect(() => {
    setLimitInput(bp.limit);
  }, [bp.limit]);

  useEffect(() => {
    if (!highlighted || !rowRef.current) return;
    rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setFlashBg(true);
    setFlashTransition(false);
    const t = setTimeout(() => { setFlashTransition(true); setFlashBg(false); }, 100);
    return () => clearTimeout(t);
  }, [highlighted]);

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

  const flashClass = `${flashBg ? 'bg-yellow-100' : ''} ${flashTransition ? 'transition-colors duration-1000' : ''}`;

  return (
    <tr ref={rowRef} className={`border border-collapse hover:bg-slate-100 ${flashClass}`}>
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

function ClosedProjectRow({ bp, highlighted, onReopen }) {
  const [flashBg, setFlashBg] = useState(false);
  const [flashTransition, setFlashTransition] = useState(false);
  const rowRef = useRef(null);

  useEffect(() => {
    if (!highlighted || !rowRef.current) return;
    rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setFlashBg(true);
    setFlashTransition(false);
    const t = setTimeout(() => { setFlashTransition(true); setFlashBg(false); }, 100);
    return () => clearTimeout(t);
  }, [highlighted]);

  const flashClass = `${flashBg ? 'bg-yellow-100' : ''} ${flashTransition ? 'transition-colors duration-1000' : ''}`;

  return (
    <tr ref={rowRef} className={`border border-collapse bg-gray-100 ${flashClass}`}>
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
