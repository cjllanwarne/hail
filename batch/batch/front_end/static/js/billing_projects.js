'use strict';

const BASE_PATH = '{{ base_path }}';

// --- Change log ---

const changes = [];

function addChange(msg) {
    changes.push(msg);
    const container = document.getElementById('change-log');
    const list = document.getElementById('change-log-list');
    if (!container || !list) return;
    container.classList.remove('hidden');
    const li = document.createElement('li');
    li.textContent = msg;
    list.appendChild(li);
    updateStickyTheadTop();
}

// --- Sticky thead ---

function updateStickyTheadTop() {
    const header = document.getElementById('bp-page-header');
    const thead = document.querySelector('#bp-table thead');
    if (header && thead) {
        thead.style.top = header.getBoundingClientRect().height + 'px';
    }
}

// --- Helpers ---

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showError(anchor, msg) {
    let err = anchor.querySelector('.bp-error');
    if (!err) {
        err = document.createElement('span');
        err.className = 'bp-error text-red-600 text-sm ml-2 block';
        anchor.append(err);
    }
    err.textContent = msg;
}

function clearError(anchor) {
    anchor.querySelector('.bp-error')?.remove();
}

async function apiPost(path, body = null) {
    const opts = { method: 'POST' };
    if (body !== null) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
    }
    const resp = await fetch(BASE_PATH + path, opts);
    if (!resp.ok) {
        let msg = resp.statusText;
        try {
            const d = await resp.json();
            msg = d.message || d.error || msg;
        } catch { /* ignore */ }
        throw new Error(msg);
    }
    return resp;
}

// --- Edit mode ---

function setEditing(row, editing) {
    row.querySelectorAll('[data-show-view]').forEach(el => el.classList.toggle('hidden', editing));
    row.querySelectorAll('[data-show-editing]').forEach(el => el.classList.toggle('hidden', !editing));
    const limitInput = row.querySelector('input[name="limit"]');
    if (limitInput) limitInput.disabled = !editing;
}

// --- DOM building ---

function makeUserRowEl(bp, user) {
    const div = document.createElement('div');
    div.className = 'group flex justify-between items-top p-0.5 rounded-sm bp-user-row';
    div.dataset.user = user;
    div.innerHTML =
        `<div>${escHtml(user)}</div>` +
        `<div class="invisible group-hover:visible" data-show-editing>` +
            `<button data-bp-remove data-bp="${escHtml(bp)}" data-user="${escHtml(user)}"` +
            ` class="hover:bg-slate-300 rounded-sm flex align-middle">` +
            `<span class="material-symbols-outlined">close</span></button>` +
        `</div>`;
    return div;
}

function makeOpenRow(bp, limit = '', users = []) {
    const tr = document.createElement('tr');
    tr.className = 'border border-collapse hover:bg-slate-100';
    tr.dataset.bp = bp;

    const userRowsHtml = users.map(u =>
        `<div class="group flex justify-between items-top p-0.5 rounded-sm bp-user-row" data-user="${escHtml(u)}">` +
            `<div>${escHtml(u)}</div>` +
            `<div class="invisible group-hover:visible hidden" data-show-editing>` +
                `<button data-bp-remove data-bp="${escHtml(bp)}" data-user="${escHtml(u)}"` +
                ` class="hover:bg-slate-300 rounded-sm flex align-middle">` +
                `<span class="material-symbols-outlined">close</span></button>` +
            `</div>` +
        `</div>`
    ).join('');

    tr.innerHTML =
        `<td class="p-2">${escHtml(bp)}</td>` +
        `<td class="p-2">` +
            `<form data-bp-limit-form="${escHtml(bp)}">` +
                `<input class="border rounded-sm w-28" type="number" name="limit"` +
                ` disabled data-original-value="${escHtml(String(limit))}" value="${escHtml(String(limit))}">` +
                `<div data-show-editing class="hidden pt-2">` +
                    `<button class="border border-gray-200 bg-gray-50 hover:bg-slate-400 hover:text-white px-2 py-1 rounded-md">Update</button>` +
                `</div>` +
            `</form>` +
        `</td>` +
        `<td class="p-2">` +
            `<div class="flex-col bp-users-container">` +
                userRowsHtml +
                `<div data-show-editing class="hidden">` +
                    `<form data-bp-add-user="${escHtml(bp)}">` +
                        `<input type="text" name="user" spellcheck="false" autocorrect="off" class="border rounded-sm w-28 mr-1">` +
                        `<button class="border border-gray-200 bg-gray-50 hover:bg-slate-400 hover:text-white px-2 py-1 rounded-md">Add</button>` +
                    `</form>` +
                `</div>` +
            `</div>` +
        `</td>` +
        `<td class="flex-col justify-center items-center">` +
            `<div class="flex justify-center" data-show-view>` +
                `<button data-bp-edit class="hover:bg-slate-300 rounded p-1 flex align-middle">` +
                    `<span class="material-symbols-outlined">edit</span>` +
                `</button>` +
            `</div>` +
            `<div class="hidden flex-col justify-around items-center space-y-1" data-show-editing>` +
                `<form data-bp-close="${escHtml(bp)}">` +
                    `<button class="border border-gray-200 bg-gray-50 hover:bg-red-700 text-red-500 hover:text-white px-2 py-1 rounded-md">Close</button>` +
                `</form>` +
                `<button data-bp-cancel class="border border-gray-200 bg-gray-50 hover:bg-slate-400 hover:text-white px-2 py-1 rounded-md">Cancel</button>` +
            `</div>` +
        `</td>`;

    attachOpenRow(tr);
    return tr;
}

function makeClosedRow(bp, limit = '', users = []) {
    const tr = document.createElement('tr');
    tr.className = 'border border-collapse bg-gray-100';
    tr.dataset.users = JSON.stringify(users);
    tr.innerHTML =
        `<td class="p-2 font-thin italic">${escHtml(bp)}</td>` +
        `<td class="p-2 font-thin" data-limit="${escHtml(String(limit))}">${escHtml(String(limit))}</td>` +
        `<td></td>` +
        `<td class="px-4">` +
            `<form data-bp-reopen="${escHtml(bp)}">` +
                `<button class="border border-gray-200 bg-gray-50 hover:bg-slate-400 hover:text-white px-2 py-1 rounded-md">Reopen</button>` +
            `</form>` +
        `</td>`;
    return tr;
}

// --- Row event wiring ---

function attachOpenRow(row) {
    row.querySelector('[data-bp-edit]')?.addEventListener('click', () => setEditing(row, true));
    row.querySelector('[data-bp-cancel]')?.addEventListener('click', () => setEditing(row, false));

    const limitForm = row.querySelector('[data-bp-limit-form]');
    if (limitForm) {
        limitForm.addEventListener('submit', async e => {
            e.preventDefault();
            const bp = limitForm.dataset.bpLimitForm;
            const input = limitForm.querySelector('input[name="limit"]');
            const oldVal = input.dataset.originalValue;
            const newVal = input.value;
            clearError(limitForm);
            try {
                const limitPayload = newVal === '' ? null : Number(newVal);
                await apiPost(`/api/v1alpha/billing_limits/${encodeURIComponent(bp)}/edit`, { limit: limitPayload });
                input.dataset.originalValue = newVal;
                addChange(`Updated limit for ${bp}: ${oldVal || 'none'} → ${newVal || 'none'}`);
            } catch (err) {
                showError(limitForm, err.message);
            }
        });
    }

    const addUserForm = row.querySelector('[data-bp-add-user]');
    if (addUserForm) {
        addUserForm.addEventListener('submit', async e => {
            e.preventDefault();
            const bp = addUserForm.dataset.bpAddUser;
            const input = addUserForm.querySelector('input[name="user"]');
            const user = input.value.trim();
            if (!user) return;
            clearError(addUserForm);
            try {
                await apiPost(`/api/v1alpha/billing_projects/${encodeURIComponent(bp)}/users/${encodeURIComponent(user)}/add`);
                const usersContainer = row.querySelector('.bp-users-container');
                const addDiv = addUserForm.closest('[data-show-editing]');
                usersContainer.insertBefore(makeUserRowEl(bp, user), addDiv);
                input.value = '';
                addChange(`Added ${user} to ${bp}`);
            } catch (err) {
                showError(addUserForm, err.message);
            }
        });
    }

    const closeForm = row.querySelector('[data-bp-close]');
    if (closeForm) {
        closeForm.addEventListener('submit', async e => {
            e.preventDefault();
            const bp = closeForm.dataset.bpClose;
            const limitInput = row.querySelector('input[name="limit"]');
            const limit = limitInput ? limitInput.value : '';
            const users = [...row.querySelectorAll('.bp-user-row')].map(r => r.dataset.user);
            clearError(closeForm);
            try {
                await apiPost(`/api/v1alpha/billing_projects/${encodeURIComponent(bp)}/close`);
                row.remove();
                document.getElementById('closed-projects-tbody').appendChild(makeClosedRow(bp, limit, users));
                addChange(`Closed billing project ${bp}`);
            } catch (err) {
                showError(closeForm, err.message);
            }
        });
    }
}

// --- Init ---

document.addEventListener('DOMContentLoaded', () => {
    updateStickyTheadTop();
    new ResizeObserver(updateStickyTheadTop).observe(document.getElementById('bp-page-header'));

    document.querySelectorAll('#open-projects-tbody tr').forEach(attachOpenRow);

    // Remove user — delegated to tbody
    document.getElementById('open-projects-tbody').addEventListener('click', async e => {
        const btn = e.target.closest('[data-bp-remove]');
        if (!btn) return;
        const bp = btn.dataset.bp;
        const user = btn.dataset.user;
        try {
            await apiPost(`/api/v1alpha/billing_projects/${encodeURIComponent(bp)}/users/${encodeURIComponent(user)}/remove`);
            btn.closest('.bp-user-row').remove();
            addChange(`Removed ${user} from ${bp}`);
        } catch (err) {
            showError(btn.closest('tr'), err.message);
        }
    });

    // Reopen — delegated to tbody
    document.getElementById('closed-projects-tbody').addEventListener('submit', async e => {
        const form = e.target.closest('[data-bp-reopen]');
        if (!form) return;
        e.preventDefault();
        const bp = form.dataset.bpReopen;
        const row = form.closest('tr');
        const limit = row.querySelector('[data-limit]')?.dataset.limit || '';
        const users = JSON.parse(row.dataset.users || '[]');
        try {
            await apiPost(`/api/v1alpha/billing_projects/${encodeURIComponent(bp)}/reopen`);
            row.remove();
            document.getElementById('open-projects-tbody').appendChild(makeOpenRow(bp, limit, users));
            addChange(`Reopened billing project ${bp}`);
        } catch (err) {
            showError(row, err.message);
        }
    });

    // Create project
    document.getElementById('bp-create-form').addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.currentTarget;
        const input = form.querySelector('input[name="billing_project"]');
        const bp = input.value.trim();
        if (!bp) return;
        clearError(form);
        try {
            await apiPost(`/api/v1alpha/billing_projects/${encodeURIComponent(bp)}/create`);
            document.getElementById('open-projects-tbody').appendChild(makeOpenRow(bp));
            input.value = '';
            addChange(`Created billing project ${bp}`);
        } catch (err) {
            showError(form, err.message);
        }
    });
});
