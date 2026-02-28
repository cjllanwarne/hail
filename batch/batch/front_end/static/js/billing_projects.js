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

// --- DOM building from templates ---

function makeUserRowEl(bp, user) {
    const tr = document.getElementById('user-row-tpl').content.cloneNode(true);
    const div = tr.querySelector('.bp-user-row');
    div.dataset.user = user;
    div.querySelector('.bp-username').textContent = user;
    const btn = div.querySelector('[data-bp-remove]');
    btn.dataset.bp = bp;
    btn.dataset.user = user;
    return div;
}

function makeOpenRow(bp, limit = '', users = []) {
    const tr = document.getElementById('open-row-tpl').content.cloneNode(true).querySelector('tr');
    tr.dataset.bp = bp;
    tr.querySelector('.bp-name').textContent = bp;
    const limitInput = tr.querySelector('input[name="limit"]');
    limitInput.value = limit;
    limitInput.dataset.originalValue = limit;
    tr.querySelector('[data-bp-limit-form]').dataset.bpLimitForm = bp;
    tr.querySelector('[data-bp-add-user]').dataset.bpAddUser = bp;
    tr.querySelector('[data-bp-close]').dataset.bpClose = bp;
    const usersContainer = tr.querySelector('.bp-users-container');
    const addDiv = usersContainer.querySelector('[data-show-editing]');
    users.forEach(u => usersContainer.insertBefore(makeUserRowEl(bp, u), addDiv));
    attachOpenRow(tr);
    return tr;
}

function makeClosedRow(bp, limit = '', users = []) {
    const tr = document.getElementById('closed-row-tpl').content.cloneNode(true).querySelector('tr');
    tr.dataset.users = JSON.stringify(users);
    tr.querySelector('.bp-name').textContent = bp;
    const limitTd = tr.querySelector('.bp-limit');
    limitTd.textContent = limit;
    limitTd.dataset.limit = limit;
    tr.querySelector('[data-bp-reopen]').dataset.bpReopen = bp;
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
        const limit = row.querySelector('.bp-limit')?.dataset.limit || '';
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
