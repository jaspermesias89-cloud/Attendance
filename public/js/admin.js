import { api, escapeHtml, initials } from './api.js';
import { loadModels, detectDescriptor, snapshotThumbnail } from './face.js';

let employees = [];
let records = [];
let settings = { threshold: 0.5, late_cutoff: '09:30' };
let currentUser = null;

const $ = (id) => document.getElementById(id);

// ================= BOOT =================
async function boot() {
  try {
    currentUser = await api('/auth/me');
  } catch {
    showLogin();
    return;
  }
  await enterApp();
}

function showLogin() {
  $('boot-screen').style.display = 'none';
  $('login-screen').style.display = 'flex';
  $('login-email').focus();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('login-err');
  errEl.textContent = '';
  try {
    const r = await api('/auth/login', {
      method: 'POST',
      body: { email: $('login-email').value.trim(), password: $('login-password').value },
    });
    currentUser = r.user;
    $('login-screen').style.display = 'none';
    $('boot-screen').style.display = 'flex';
    await enterApp();
  } catch (err) {
    errEl.textContent = err.message || 'Sign-in failed';
  }
});

async function enterApp() {
  $('user-email').textContent = currentUser.email;
  $('boot-text').textContent = 'LOADING RECOGNITION ENGINE…';
  try {
    await loadModels((m) => ($('boot-text').textContent = m));
  } catch {
    $('model-dot').className = 'status-dot bad';
    $('model-status-text').textContent = 'Engine failed to load';
  }
  await refreshData();
  applySettingsToUI();
  $('boot-screen').style.display = 'none';
  $('app').style.display = 'flex';
  startClock();
  renderDashboard();
}

$('btn-logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  location.reload();
});

async function refreshData() {
  [employees, records, settings] = await Promise.all([
    api('/employees'),
    api('/attendance'),
    api('/settings'),
  ]);
}

function startClock() {
  const el = $('clock');
  const tick = () => {
    el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  tick();
  setInterval(tick, 1000);
}

// ================= NAV =================
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    const page = btn.dataset.page;
    $('page-' + page).classList.add('active');
    const titles = { dashboard: 'Dashboard', register: 'Register Employee', records: 'Attendance Records', devices: 'Check-in Kiosks', settings: 'Settings' };
    $('page-title').textContent = titles[page];
    if (page !== 'register') stopRegCam();
    if (page === 'dashboard') { await refreshData(); renderDashboard(); }
    if (page === 'records') { records = await api('/attendance'); renderRecords(); }
    if (page === 'register') { employees = await api('/employees'); renderEmployeeTable(); }
    if (page === 'devices') renderDevices();
  });
});

// ================= helpers =================
function todayStr(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function avatarHtml(photo, name) {
  return photo ? `<img src="${photo}">` : initials(name);
}
function toast(title, body, cls = '') {
  const stack = $('toast-stack');
  const t = document.createElement('div');
  t.className = 'toast ' + cls;
  t.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(body)}`;
  stack.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3400);
}

// ================= DASHBOARD =================
async function renderDashboard() {
  const summary = await api('/attendance/summary');
  $('stat-registered').textContent = summary.total;
  $('stat-present').textContent = summary.present;
  $('stat-late').textContent = summary.late;
  $('stat-absent').textContent = summary.absent;
  $('stat-present-pct').textContent = summary.total
    ? Math.round(((summary.present + summary.late) / summary.total) * 100) + '% of workforce'
    : 'No employees yet';

  const recent = [...records].slice(0, 8);
  const recentWrap = $('recent-activity');
  if (recent.length === 0) {
    recentWrap.innerHTML = '<div class="empty-note">No attendance recorded yet.</div>';
  } else {
    recentWrap.innerHTML = recent.map((r) => `
      <div class="activity-row">
        <div class="avatar">${avatarHtml(r.photo, r.name)}</div>
        <div class="activity-info">
          <div class="activity-name">${escapeHtml(r.name)}</div>
          <div class="activity-meta">${escapeHtml(r.department)} · ${fmtDate(r.local_date)} at ${r.local_time} · ${r.kind}</div>
        </div>
        <span class="badge ${r.status}">${r.status === 'late' ? 'Late' : 'Present'}</span>
      </div>`).join('');
  }

  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d); }
  const maxTotal = Math.max(1, summary.total);
  $('week-bars').innerHTML = days.map((d) => {
    const ds = todayStr(d);
    const count = records.filter((r) => r.local_date === ds).length;
    const pct = Math.min(100, Math.round((count / maxTotal) * 100));
    return `<div class="bar-row">
      <div class="bar-day">${d.toLocaleDateString([], { weekday: 'short' })}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="bar-pct">${count}</div>
    </div>`;
  }).join('');
}

// ================= REGISTER =================
let regStream = null;
let tempDescriptors = [];
let tempPhoto = null;

$('btn-reg-cam').addEventListener('click', async () => {
  if (regStream) return stopRegCam();
  try {
    regStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    $('reg-video').srcObject = regStream;
    $('reg-cam-msg').style.display = 'none';
    $('btn-reg-cam').textContent = 'Disable Camera';
    $('btn-capture').disabled = false;
  } catch (e) {
    toast('Camera error', e.message, 'error');
  }
});

function stopRegCam() {
  if (regStream) { regStream.getTracks().forEach((t) => t.stop()); regStream = null; }
  const v = $('reg-video'); if (v) v.srcObject = null;
  const msg = $('reg-cam-msg'); if (msg) msg.style.display = 'flex';
  const b = $('btn-reg-cam'); if (b) b.textContent = 'Enable Camera';
  const c = $('btn-capture'); if (c) c.disabled = true;
}

$('btn-capture').addEventListener('click', async () => {
  const video = $('reg-video');
  const btn = $('btn-capture');
  btn.disabled = true; btn.textContent = 'Detecting…';
  const desc = await detectDescriptor(video);
  if (!desc) {
    btn.textContent = `Capture Sample (${tempDescriptors.length}/3)`;
    btn.disabled = false;
    flashHint('No face detected — center your face and try again.', true);
    return;
  }
  tempDescriptors.push(desc);
  if (!tempPhoto) tempPhoto = snapshotThumbnail(video);
  updateSampleDots();
  if (tempDescriptors.length >= 3) { btn.disabled = true; btn.textContent = 'All samples captured'; }
  else { btn.disabled = false; btn.textContent = `Capture Sample (${tempDescriptors.length}/3)`; }
  checkSaveEnabled();
});

function flashHint(msg, warn) {
  const hint = $('reg-hint');
  hint.textContent = msg;
  hint.style.color = warn ? 'var(--danger)' : 'var(--text-faint)';
  setTimeout(() => { hint.style.color = 'var(--text-faint)'; hint.textContent = 'Capture 3 face samples, then fill in the details above.'; }, 2200);
}
function updateSampleDots() {
  document.querySelectorAll('#sample-row .sample-dot').forEach((d, i) => d.classList.toggle('filled', i < tempDescriptors.length));
}
['reg-name', 'reg-id', 'reg-dept'].forEach((id) => $(id).addEventListener('input', checkSaveEnabled));
$('reg-consent').addEventListener('change', checkSaveEnabled);
function checkSaveEnabled() {
  const ok = $('reg-name').value.trim() && $('reg-id').value.trim() && $('reg-dept').value.trim()
    && $('reg-consent').checked && tempDescriptors.length >= 3;
  $('btn-save-employee').disabled = !ok;
}

$('btn-save-employee').addEventListener('click', async () => {
  const btn = $('btn-save-employee');
  const name = $('reg-name').value.trim();
  btn.disabled = true;
  try {
    await api('/employees', {
      method: 'POST',
      body: {
        emp_code: $('reg-id').value.trim(),
        name,
        department: $('reg-dept').value.trim(),
        descriptors: tempDescriptors,
        photo: tempPhoto,
      },
    });
    employees = await api('/employees');
    renderEmployeeTable();
    resetRegistrationForm();
    toast('Enrolled', name + ' saved successfully');
  } catch (e) {
    toast('Could not save', e.message, 'error');
    btn.disabled = false;
  }
});

function resetRegistrationForm() {
  tempDescriptors = []; tempPhoto = null;
  ['reg-name', 'reg-id', 'reg-dept'].forEach((id) => ($(id).value = ''));
  $('reg-consent').checked = false;
  updateSampleDots();
  $('btn-capture').textContent = 'Capture Sample (0/3)';
  $('btn-capture').disabled = !regStream;
  $('btn-save-employee').disabled = true;
}

function renderEmployeeTable() {
  $('emp-count').textContent = employees.length;
  const tbody = $('employee-table');
  if (employees.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-note">No employees enrolled yet.</td></tr>';
    return;
  }
  tbody.innerHTML = employees.map((e) => `
    <tr>
      <td class="name-cell"><div class="avatar">${avatarHtml(e.photo, e.name)}</div>${escapeHtml(e.name)}</td>
      <td class="mono">${escapeHtml(e.emp_code)}</td>
      <td>${escapeHtml(e.department)}</td>
      <td class="mono">${e.enrolled_at}</td>
      <td><button class="btn danger-outline" data-remove="${e.id}" style="padding:5px 10px; font-size:11px;">Remove</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      confirmModal('Remove employee?', 'This deletes the employee and their attendance history. This cannot be undone.', async () => {
        await api('/employees/' + btn.dataset.remove, { method: 'DELETE' });
        employees = await api('/employees');
        renderEmployeeTable();
      });
    });
  });
}

// ================= RECORDS =================
async function renderRecords() {
  const q = $('filter-search').value.trim();
  const date = $('filter-date').value;
  const status = $('filter-status').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (date) params.set('date', date);
  if (status) params.set('status', status);
  const rows = await api('/attendance' + (params.toString() ? '?' + params : ''));
  const tbody = $('records-table');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-note">No records match your filters.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.department)}</td>
      <td class="mono">${r.local_date}</td>
      <td class="mono">${r.local_time}</td>
      <td class="mono">${r.kind}</td>
      <td><span class="badge ${r.status}">${r.status === 'late' ? 'Late' : 'Present'}</span></td>
      <td class="mono">${r.confidence}%</td>
    </tr>`).join('');
}
let filterTimer;
['filter-search', 'filter-date', 'filter-status'].forEach((id) =>
  $(id).addEventListener('input', () => { clearTimeout(filterTimer); filterTimer = setTimeout(renderRecords, 200); }));
$('btn-clear-filters').addEventListener('click', () => {
  $('filter-search').value = ''; $('filter-date').value = ''; $('filter-status').value = '';
  renderRecords();
});

// ================= DEVICES =================
async function renderDevices() {
  const list = await api('/devices');
  const tbody = $('devices-table');
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-note">No kiosks yet.</td></tr>';
  } else {
    tbody.innerHTML = list.map((d) => `
      <tr>
        <td>${escapeHtml(d.name)}</td>
        <td class="mono">${d.last_seen ? new Date(d.last_seen).toLocaleString() : 'never'}</td>
        <td><button class="btn danger-outline" data-del-dev="${d.id}" style="padding:5px 10px; font-size:11px;">Remove</button></td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-del-dev]').forEach((btn) =>
      btn.addEventListener('click', () => {
        confirmModal('Remove kiosk?', 'That device will no longer be able to check people in.', async () => {
          await api('/devices/' + btn.dataset.delDev, { method: 'DELETE' });
          renderDevices();
        });
      }));
  }
}
$('btn-add-device').addEventListener('click', async () => {
  const name = $('device-name').value.trim() || 'Kiosk';
  const dev = await api('/devices', { method: 'POST', body: { name } });
  const link = `${location.origin}/kiosk.html#token=${encodeURIComponent(dev.token)}`;
  $('new-device-out').innerHTML = `
    <p class="setting-note" style="margin-top:14px;">Open this link on <strong>${escapeHtml(name)}</strong>. It contains the token — copy it now, it won't be shown again.</p>
    <div class="token-box">${escapeHtml(link)}</div>
    <button class="btn full" id="btn-copy-link" style="margin-top:8px;">Copy link</button>`;
  $('device-name').value = '';
  $('btn-copy-link').addEventListener('click', () => {
    navigator.clipboard.writeText(link).then(() => toast('Copied', 'Kiosk link copied to clipboard'));
  });
  renderDevices();
});

// ================= SETTINGS =================
function applySettingsToUI() {
  $('threshold-slider').value = settings.threshold;
  $('threshold-val').textContent = Number(settings.threshold).toFixed(2);
  $('cutoff-time').value = settings.late_cutoff;
}
let settingsTimer;
$('threshold-slider').addEventListener('input', (e) => {
  settings.threshold = parseFloat(e.target.value);
  $('threshold-val').textContent = settings.threshold.toFixed(2);
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(saveSettings, 300);
});
$('cutoff-time').addEventListener('change', (e) => { settings.late_cutoff = e.target.value; saveSettings(); });
async function saveSettings() {
  settings = await api('/settings', { method: 'PUT', body: { threshold: settings.threshold, late_cutoff: settings.late_cutoff } });
}
$('btn-clear-data').addEventListener('click', () => {
  confirmModal('Clear all data?', 'This permanently deletes every enrolled employee and attendance record. This cannot be undone.', async () => {
    await api('/settings/clear-data', { method: 'POST' });
    await refreshData();
    renderDashboard();
    renderEmployeeTable();
    toast('Cleared', 'All employees and records deleted');
  });
});

// ================= MODAL =================
function confirmModal(title, body, onConfirm) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal">
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(body)}</p>
    <div class="modal-actions">
      <button class="btn" data-cancel>Cancel</button>
      <button class="btn danger-outline" data-confirm>Delete</button>
    </div></div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('[data-cancel]').onclick = () => backdrop.remove();
  backdrop.querySelector('[data-confirm]').onclick = () => { onConfirm(); backdrop.remove(); };
}

boot();
