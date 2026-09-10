'use strict';
/* Service Colossus SPA — vanilla JS, hash routing, no build step. */

const $app = document.getElementById('app');
const $modalRoot = document.getElementById('modal-root');

const App = { me: null, settings: {}, users: [], pricebook: [] };

// ---------------------------------------------------------------- utilities

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { renderLogin(); throw new Error('Not signed in'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
const fmtDT = (iso) => iso ? fmtDate(iso) + ' ' + fmtTime(iso) : '—';
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

function toast(msg, isErr) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
const oops = (e) => toast(e.message || 'Something went wrong', true);

function userName(id) { const u = App.users.find((x) => x.id === id); return u ? u.name : '—'; }
function userColor(id) { const u = App.users.find((x) => x.id === id); return u ? (u.color || '#495057') : '#adb5bd'; }
function tradeName(id) { const t = (App.settings.trades || []).find((x) => x.id === id); return t ? t.name : '—'; }
function tradeColor(id) { const t = (App.settings.trades || []).find((x) => x.id === id); return t ? (t.color || '#0f4c81') : '#5a7184'; }
function jobTypeName(id) { const t = (App.settings.jobTypes || []).find((x) => x.id === id); return t ? t.name : '—'; }
const techs = () => App.users.filter((u) => u.role === 'technician' && u.active !== false);
const pill = (s) => `<span class="pill ${esc(s)}">${esc(String(s).replace('-', ' '))}</span>`;

// ---------------------------------------------------------------- modal

function openModal(html, wide) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal${wide ? ' wide' : ''}">${html}</div>`;
  back.addEventListener('mousedown', (e) => { if (e.target === back) back.remove(); });
  back.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => back.remove()));
  $modalRoot.appendChild(back);
  const first = back.querySelector('input, select, textarea');
  if (first) first.focus();
  return back;
}
const modalHead = (title) => `<div class="modal-head"><h2>${esc(title)}</h2><button class="x" data-close>&times;</button></div>`;
const modalFoot = (okLabel, okId) => `<div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="${okId}">${esc(okLabel)}</button></div>`;

function selectOptions(list, valueKey, labelKey, selected) {
  return list.map((o) => `<option value="${esc(o[valueKey])}" ${o[valueKey] === selected ? 'selected' : ''}>${esc(o[labelKey])}</option>`).join('');
}

// ---------------------------------------------------------------- login & shell

function renderLogin() {
  App.me = null;
  $app.innerHTML = `
    <div class="login-wrap"><div class="login-card">
      <h1 style="display:flex; align-items:center; gap:8px"><span style="color:var(--accent); display:inline-flex; width:22px">${ICONS.mark}</span>Service Colossus</h1>
      <div class="sub">OpenTrades field service platform</div>
      <div class="field"><label>Email</label><input id="li-email" type="email" autocomplete="username" value=""></div>
      <div class="field"><label>Password</label><input id="li-pass" type="password" autocomplete="current-password"></div>
      <button class="btn primary" id="li-go" style="width:100%">Sign in</button>
      <div class="login-hint">First run? Sign in as <b>admin@opentrades.local</b> / <b>colossus</b>, then add your team in Settings.</div>
    </div></div>`;
  const go = async () => {
    try {
      const r = await api('/api/login', { method: 'POST', body: { email: val('li-email'), password: val('li-pass') } });
      App.me = r.user;
      await boot();
    } catch (e) { oops(e); }
  };
  document.getElementById('li-go').addEventListener('click', go);
  $app.addEventListener('keydown', (e) => { if (e.key === 'Enter' && document.getElementById('li-go')) go(); });
}
const val = (id) => (document.getElementById(id) || {}).value || '';

// Monochrome line icons (Feather-style): stroke follows the sidebar color,
// so nothing carries a white fill onto the dark rail.
const svgIcon = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  mark: svgIcon('<path d="M12 2 3 7h18z"/><path d="M4 21h16"/><path d="M6 10v8M10 10v8M14 10v8M18 10v8"/>'),
  dashboard: svgIcon('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'),
  dispatch: svgIcon('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  jobs: svgIcon('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
  customers: svgIcon('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  estimates: svgIcon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
  invoices: svgIcon('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
  pricebook: svgIcon('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'),
  settings: svgIcon('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'),
};

const NAV = [
  ['dashboard', 'Dashboard'],
  ['dispatch', 'Dispatch'],
  ['jobs', 'Jobs'],
  ['customers', 'Customers'],
  ['estimates', 'Estimates'],
  ['invoices', 'Invoices'],
  ['pricebook', 'Pricebook'],
  ['settings', 'Settings'],
];

function renderShell(active, contentHtml) {
  const navItems = NAV
    .filter(([k]) => k !== 'settings' || App.me.role !== 'technician')
    .map(([k, label]) => `<a href="#/${k}" class="${active === k ? 'active' : ''}" data-tip="${esc(label)}" aria-label="${esc(label)}">${ICONS[k]}</a>`)
    .join('');
  $app.innerHTML = `
    <div class="shell">
      <div class="sidebar">
        <div class="logo-mark" title="Service Colossus — ${esc(App.settings.companyName || 'OpenTrades')}">${ICONS.mark}</div>
        <nav class="nav">${navItems}</nav>
        <div class="whoami">
          <button class="whoami-btn" id="nav-logout" data-tip="${esc(App.me.name)} (${esc(App.me.role)}) — sign out" aria-label="Sign out">
            <span class="avatar" style="background:${esc(App.me.color || '#495057')}">${esc(App.me.name.slice(0, 2).toUpperCase())}</span>
          </button>
        </div>
      </div>
      <div class="topbar">
        <input class="global-search" id="global-search" placeholder="Search customers, jobs… (press Enter)">
        <div class="spacer"></div>
        <button class="btn" id="new-customer-btn">+ Customer</button>
        <button class="btn" id="new-estimate-btn">+ Estimate</button>
        <button class="btn primary" id="new-job-btn">＋ New Job</button>
      </div>
      <div class="main" id="main">${contentHtml}</div>
    </div>`;
  document.getElementById('nav-logout').addEventListener('click', async (e) => {
    e.preventDefault();
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    renderLogin();
  });
  document.getElementById('new-job-btn').addEventListener('click', () => newJobModal());
  document.getElementById('new-customer-btn').addEventListener('click', () => newCustomerModal());
  document.getElementById('new-estimate-btn').addEventListener('click', () => newEstimateModal());
  document.getElementById('global-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') location.hash = '#/customers?q=' + encodeURIComponent(e.target.value);
  });
}

// ---------------------------------------------------------------- router

async function boot() {
  const b = await api('/api/bootstrap');
  Object.assign(App, b);
  route();
}

window.addEventListener('hashchange', () => { if (App.me) route(); });

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [pathPart, queryPart] = h.split('?');
  const parts = pathPart.split('/');
  return { page: parts[0] || 'dashboard', id: parts[1] || null, query: new URLSearchParams(queryPart || '') };
}

async function route() {
  const { page, id, query } = parseHash();
  try {
    if (page === 'dashboard') await viewDashboard();
    else if (page === 'dispatch') await viewDispatch(query.get('date') || todayStr());
    else if (page === 'jobs' && id) await viewJob(id);
    else if (page === 'jobs') await viewJobs(query);
    else if (page === 'customers' && id) await viewCustomer(id);
    else if (page === 'customers') await viewCustomers(query.get('q') || '');
    else if (page === 'estimates' && id) await viewEstimate(id);
    else if (page === 'estimates') await viewEstimates(query.get('status') || '');
    else if (page === 'invoices' && id) await viewInvoice(id);
    else if (page === 'invoices') await viewInvoices(query.get('status') || '');
    else if (page === 'pricebook') await viewPricebook();
    else if (page === 'settings') await viewSettings();
    else await viewDashboard();
  } catch (e) { if (e.message !== 'Not signed in') oops(e); }
}

// ---------------------------------------------------------------- dashboard

async function viewDashboard() {
  const d = await api('/api/dashboard');
  const k = d.counts;
  renderShell('dashboard', `
    <div class="page-head"><h1>Dashboard</h1><div class="spacer"></div><span class="muted">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span></div>
    <div class="kpis">
      <div class="kpi"><div class="v">${k.jobsToday}</div><div class="l">Jobs today</div></div>
      <div class="kpi"><div class="v">${k.unassignedToday}</div><div class="l">Unassigned today</div></div>
      <div class="kpi"><div class="v">${k.openEstimates}</div><div class="l">Open estimates</div></div>
      <div class="kpi"><div class="v">${money(k.openEstimateValue)}</div><div class="l">Pipeline value</div></div>
      <div class="kpi"><div class="v">${money(k.soldThisMonth)}</div><div class="l">Sold this month</div></div>
      <div class="kpi"><div class="v">${money(k.arBalance)}</div><div class="l">Outstanding A/R</div></div>
    </div>
    <div class="two-col">
      <div class="card tight">
        <h2>Today's jobs</h2>
        ${jobsTable(d.jobsToday)}
      </div>
      <div class="card tight">
        <h2>Recent activity</h2>
        <div style="padding: 8px 16px; max-height: 480px; overflow-y: auto">
          ${d.activity.length ? d.activity.map((a) => `
            <div class="note small"><b>${esc(userName(a.userId))}</b> ${esc(a.action)} ${esc(a.entity)} ${esc(a.detail)}<br><span class="muted">${fmtDT(a.at)}</span></div>
          `).join('') : '<div class="empty">No activity yet</div>'}
        </div>
      </div>
    </div>`);
  wireJobRows();
}

function jobsTable(jobs) {
  if (!jobs.length) return '<div class="empty">No jobs — create one with ＋ New Job</div>';
  return `<div style="overflow-x:auto"><table class="list">
    <thead><tr><th>Job</th><th>Time</th><th>Customer</th><th>Type</th><th>Techs</th><th>Status</th></tr></thead>
    <tbody>${jobs.map((j) => `
      <tr class="click" data-job="${j.id}">
        <td><b>#${j.number}</b><br><span class="small muted">${esc(j.summary)}</span></td>
        <td>${j.start ? fmtTime(j.start) : '<span class="muted">unscheduled</span>'}</td>
        <td>${esc(j.customerName)}<br><span class="small muted">${esc(j.address)}</span></td>
        <td><span class="tagchip" style="border-left:3px solid ${tradeColor(j.tradeId)}">${esc(tradeName(j.tradeId))}</span> ${esc(jobTypeName(j.jobTypeId))}</td>
        <td>${(j.techIds || []).map((t) => esc(userName(t))).join(', ') || '<span class="muted">—</span>'}</td>
        <td>${pill(j.status)}${j.priority !== 'normal' ? ' ' + pill(j.priority) : ''}</td>
      </tr>`).join('')}</tbody></table></div>`;
}
function wireJobRows() {
  document.querySelectorAll('[data-job]').forEach((r) => r.addEventListener('click', () => { location.hash = '#/jobs/' + r.dataset.job; }));
}

// ---------------------------------------------------------------- dispatch board

async function viewDispatch(date) {
  const [jobs, allJobs] = await Promise.all([api(`/api/jobs?from=${date}&to=${date}`), api('/api/jobs')]);
  const backlog = allJobs.filter((j) => !j.start && !['completed', 'canceled'].includes(j.status));
  const hours = App.settings.businessHours || { start: 7, end: 19 };
  const span = hours.end - hours.start;
  const lanes = [{ id: null, name: 'Unassigned', color: '#868e96' }, ...techs()];
  const hourCells = Array.from({ length: span }, (_, i) => {
    const h = hours.start + i;
    return `<div class="cell">${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}</div>`;
  }).join('');

  const laneHtml = lanes.map((lane) => {
    const laneJobs = jobs.filter((j) => lane.id === null ? !(j.techIds || []).length : (j.techIds || []).includes(lane.id));
    // stack chips that overlap in time so none hide each other
    const placed = [];
    let rows = 1;
    const chips = laneJobs.map((j) => {
      const st = j.start ? new Date(j.start) : null;
      const en = j.end ? new Date(j.end) : null;
      let leftPct = 2, widthPct = 20;
      if (st) {
        const sh = st.getHours() + st.getMinutes() / 60;
        const eh = en ? en.getHours() + en.getMinutes() / 60 : sh + 2;
        leftPct = Math.max(0, Math.min(97, ((sh - hours.start) / span) * 100));
        widthPct = Math.max(6, Math.min(100 - leftPct, ((eh - sh) / span) * 100));
      }
      let row = 0;
      while (placed.some((p) => p.row === row && leftPct < p.left + p.width && p.left < leftPct + widthPct)) row++;
      placed.push({ row, left: leftPct, width: widthPct });
      rows = Math.max(rows, row + 1);
      return `<div class="jobchip st-${esc(j.status)}" data-job="${j.id}" title="#${j.number} ${esc(j.summary)}"
        style="left:${leftPct}%; width:${widthPct}%; top:${6 + row * 52}px; background:${tradeColor(j.tradeId)}">
        <b>#${j.number} ${esc(j.customerName)}</b><span>${esc(j.summary)}</span></div>`;
    }).join('');
    return `<div class="board-row">
      <div class="board-tech"><span class="dot" style="background:${lane.color || '#868e96'}"></span>${esc(lane.name)}</div>
      <div class="board-lane" style="min-height:${6 + rows * 52 + 6}px">${chips}</div></div>`;
  }).join('');

  renderShell('dispatch', `
    <div class="page-head">
      <h1>Dispatch board</h1>
      <button class="btn small" id="d-prev">‹</button>
      <input type="date" id="d-date" value="${esc(date)}" style="width:160px">
      <button class="btn small" id="d-next">›</button>
      <button class="btn small" id="d-today">Today</button>
      <div class="spacer"></div>
      <span class="muted small">${jobs.length} job(s) · chips colored by trade · click a job to open it</span>
    </div>
    <div class="card tight board">
      <div class="board-grid">
        <div class="board-hours"><div class="board-tech" style="border-bottom:0">Technician</div>
          <div class="cells" style="grid-template-columns: repeat(${span}, 1fr)">${hourCells}</div></div>
        ${laneHtml}
      </div>
    </div>
    <div class="card tight"><h2>Unscheduled &amp; open jobs</h2>${jobsTable(backlog)}</div>`);

  const shift = (days) => {
    const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + days);
    location.hash = '#/dispatch?date=' + d.toISOString().slice(0, 10);
  };
  document.getElementById('d-prev').addEventListener('click', () => shift(-1));
  document.getElementById('d-next').addEventListener('click', () => shift(1));
  document.getElementById('d-today').addEventListener('click', () => { location.hash = '#/dispatch?date=' + todayStr(); });
  document.getElementById('d-date').addEventListener('change', (e) => { location.hash = '#/dispatch?date=' + e.target.value; });
  wireJobRows();
  document.querySelectorAll('.jobchip').forEach((c) => c.addEventListener('click', () => { location.hash = '#/jobs/' + c.dataset.job; }));
}

// ---------------------------------------------------------------- jobs

async function viewJobs(query) {
  const status = query.get('status') || '';
  const q = query.get('q') || '';
  const jobs = await api(`/api/jobs?${new URLSearchParams({ ...(status && { status }), ...(q && { q }) })}`);
  const tabs = ['', 'scheduled', 'dispatched', 'in-progress', 'on-hold', 'completed', 'canceled'];
  renderShell('jobs', `
    <div class="page-head"><h1>Jobs</h1>
      <div class="status-bar">${tabs.map((t) => `<a class="btn small ${t === status ? 'on' : ''}" href="#/jobs${t ? '?status=' + t : ''}">${t ? t.replace('-', ' ') : 'All'}</a>`).join('')}</div>
      <div class="spacer"></div>
      <input id="job-q" placeholder="Search jobs…" style="width:220px" value="${esc(q)}">
    </div>
    <div class="card tight">${jobsTable(jobs)}</div>`);
  document.getElementById('job-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') location.hash = '#/jobs?q=' + encodeURIComponent(e.target.value) + (status ? '&status=' + status : '');
  });
  wireJobRows();
}

async function viewJob(id) {
  const j = await api('/api/jobs/' + id);
  const canEdit = App.me.role !== 'technician' || (j.techIds || []).includes(App.me.id);
  const statusBtns = ['scheduled', 'dispatched', 'in-progress', 'on-hold', 'completed', 'canceled']
    .map((s) => `<button class="btn small ${j.status === s ? 'on' : ''}" data-status="${s}" ${canEdit ? '' : 'disabled'}>${s.replace('-', ' ')}</button>`).join('');
  renderShell('jobs', `
    <div class="page-head">
      <a href="#/jobs" class="btn small">‹ Jobs</a>
      <h1>Job #${j.number} — ${esc(j.summary)}</h1>
      ${pill(j.status)} ${j.priority !== 'normal' ? pill(j.priority) : ''}
      <div class="spacer"></div>
      ${canEdit ? `<button class="btn" id="job-edit">Edit job</button>` : ''}
      <button class="btn" id="job-est">+ Estimate</button>
      <button class="btn" id="job-inv">+ Invoice</button>
    </div>
    <div class="card"><div class="status-bar">${statusBtns}</div></div>
    <div class="two-col">
      <div>
        <div class="card">
          <h2>Details</h2>
          <div class="row">
            <div><label>Customer</label><a href="#/customers/${j.customerId}">${esc(j.customerName)}</a><div class="small muted">${esc(j.customerPhone)}</div></div>
            <div><label>Location</label>${esc(j.address) || '<span class="muted">—</span>'}${j.location && j.location.gateCode ? `<div class="small muted">Gate: ${esc(j.location.gateCode)}</div>` : ''}</div>
          </div>
          <div class="row" style="margin-top:12px">
            <div><label>Trade</label><span class="tagchip" style="border-left:3px solid ${tradeColor(j.tradeId)}">${esc(tradeName(j.tradeId))}</span></div>
            <div><label>Job type</label>${esc(jobTypeName(j.jobTypeId))}</div>
            <div><label>Lead source</label>${esc(j.leadSource) || '—'}</div>
          </div>
          <div class="row" style="margin-top:12px">
            <div><label>Scheduled</label>${j.start ? fmtDT(j.start) + (j.end ? ' – ' + fmtTime(j.end) : '') : '<span class="muted">unscheduled</span>'}</div>
            <div><label>Technicians</label>${(j.techIds || []).map((t) => `<span class="tagchip">${esc(userName(t))}</span>`).join('') || '<span class="muted">unassigned</span>'}</div>
            <div><label>Tags</label>${(j.tags || []).map((t) => `<span class="tagchip">${esc(t)}</span>`).join('') || '—'}</div>
          </div>
        </div>
        <div class="card">
          <h2>Notes</h2>
          <div id="job-notes">${(j.notes || []).map((n) => `<div class="note"><b>${esc(userName(n.userId))}</b> <span class="muted small">${fmtDT(n.at)}</span><br>${esc(n.text)}</div>`).join('') || '<div class="muted">No notes yet</div>'}</div>
          <div class="row" style="margin-top:10px"><input id="job-note-text" placeholder="Add a note…"><button class="btn" id="job-note-add" style="flex:none">Add</button></div>
        </div>
      </div>
      <div>
        <div class="card tight"><h2>Estimates</h2>${miniList(j.estimates, 'estimates', (e) => `#${e.number} ${esc(e.name)} · ${money(e.total)} ${pill(e.status)}`)}</div>
        <div class="card tight"><h2>Invoices</h2>${miniList(j.invoices, 'invoices', (i) => `#${i.number} · ${money(i.total)} ${pill(i.status)}`)}</div>
      </div>
    </div>`);
  document.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('/api/jobs/' + j.id, { method: 'PUT', body: { status: b.dataset.status } }); toast('Status updated'); viewJob(j.id); } catch (e) { oops(e); }
  }));
  document.getElementById('job-note-add').addEventListener('click', async () => {
    const text = val('job-note-text');
    if (!text) return;
    try { await api('/api/jobs/' + j.id, { method: 'PUT', body: { addNote: text } }); viewJob(j.id); } catch (e) { oops(e); }
  });
  const editBtn = document.getElementById('job-edit');
  if (editBtn) editBtn.addEventListener('click', () => editJobModal(j));
  document.getElementById('job-est').addEventListener('click', () => newEstimateModal({ customerId: j.customerId, locationId: j.locationId, jobId: j.id }));
  document.getElementById('job-inv').addEventListener('click', () => newEstimateModal({ customerId: j.customerId, locationId: j.locationId, jobId: j.id, asInvoice: true }));
}

function miniList(list, page, fmt) {
  if (!list || !list.length) return '<div class="empty small">None</div>';
  return `<div style="padding:6px 16px">${list.map((x) => `<div class="note small"><a href="#/${page}/${x.id}">${fmt(x)}</a></div>`).join('')}</div>`;
}

function scheduleFields(j) {
  const startDate = j && j.start ? j.start.slice(0, 10) : '';
  const startTime = j && j.start ? new Date(j.start).toTimeString().slice(0, 5) : '';
  const endTime = j && j.end ? new Date(j.end).toTimeString().slice(0, 5) : '';
  return `
    <div class="row">
      <div class="field"><label>Date</label><input type="date" id="jf-date" value="${startDate}"></div>
      <div class="field"><label>Start</label><input type="time" id="jf-start" value="${startTime}"></div>
      <div class="field"><label>End</label><input type="time" id="jf-end" value="${endTime}"></div>
    </div>
    <div class="field"><label>Technicians</label>
      <div class="row" style="flex-wrap:wrap">${techs().map((t) => `
        <label class="check" style="flex:none"><input type="checkbox" class="jf-tech" value="${t.id}" ${j && (j.techIds || []).includes(t.id) ? 'checked' : ''}> ${esc(t.name)}</label>`).join('') || '<span class="muted">No technicians yet — add them in Settings</span>'}
      </div>
    </div>`;
}

function readScheduleFields() {
  const date = val('jf-date');
  const start = val('jf-start');
  const end = val('jf-end');
  const techIds = [...document.querySelectorAll('.jf-tech:checked')].map((c) => c.value);
  return {
    start: date && start ? new Date(date + 'T' + start).toISOString() : null,
    end: date && end ? new Date(date + 'T' + end).toISOString() : null,
    techIds,
  };
}

function jobCoreFields(j) {
  return `
    <div class="row">
      <div class="field"><label>Trade</label><select id="jf-trade"><option value="">—</option>${selectOptions(App.settings.trades || [], 'id', 'name', j && j.tradeId)}</select></div>
      <div class="field"><label>Job type</label><select id="jf-type"><option value="">—</option>${selectOptions(App.settings.jobTypes || [], 'id', 'name', j && j.jobTypeId)}</select></div>
      <div class="field"><label>Priority</label><select id="jf-priority">${['low', 'normal', 'high', 'urgent'].map((p) => `<option ${j && j.priority === p ? 'selected' : (!j && p === 'normal' ? 'selected' : '')}>${p}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>Job summary</label><input id="jf-summary" value="${esc(j ? j.summary : '')}" placeholder="e.g. No cooling — upstairs unit"></div>
    ${scheduleFields(j)}`;
}

async function editJobModal(j) {
  const m = openModal(`${modalHead('Edit job #' + j.number)}<div class="modal-body">${jobCoreFields(j)}</div>${modalFoot('Save', 'jf-save')}`);
  m.querySelector('#jf-save').addEventListener('click', async () => {
    try {
      await api('/api/jobs/' + j.id, {
        method: 'PUT',
        body: { tradeId: val('jf-trade'), jobTypeId: val('jf-type'), priority: val('jf-priority'), summary: val('jf-summary'), ...readScheduleFields() },
      });
      m.remove(); toast('Job updated'); viewJob(j.id);
    } catch (e) { oops(e); }
  });
}

// ---------------------------------------------------------------- customer picker + new job

function customerPicker() {
  return `
    <div class="field"><label>Customer</label>
      <input id="cp-search" placeholder="Search by name, phone, or address…" autocomplete="off">
      <input type="hidden" id="cp-id"><input type="hidden" id="cp-loc">
      <div id="cp-results" class="card tight" style="display:none; max-height:180px; overflow-y:auto; margin:4px 0 0"></div>
      <div id="cp-chosen" class="small" style="margin-top:6px"></div>
      <button class="linklike small" id="cp-new" type="button">+ New customer</button>
    </div>`;
}

function wireCustomerPicker(m, preset) {
  const search = m.querySelector('#cp-search');
  const results = m.querySelector('#cp-results');
  const chosen = m.querySelector('#cp-chosen');
  let t = null;

  function choose(c, loc) {
    m.querySelector('#cp-id').value = c.id;
    const locations = c.locations || [];
    const chosenLoc = loc || locations[0];
    m.querySelector('#cp-loc').value = chosenLoc ? chosenLoc.id : '';
    search.value = c.name;
    results.style.display = 'none';
    chosen.innerHTML = `✓ <b>${esc(c.name)}</b> ${esc(c.phone || '')}` + (locations.length > 1
      ? ` · <select id="cp-loc-pick" style="width:auto; display:inline-block; padding:2px 6px">${locations.map((l) => `<option value="${l.id}" ${chosenLoc && l.id === chosenLoc.id ? 'selected' : ''}>${esc(l.address)}</option>`).join('')}</select>`
      : (chosenLoc ? ` · ${esc(chosenLoc.address)}` : ' · <span class="muted">no address on file</span>'));
    const lp = chosen.querySelector('#cp-loc-pick');
    if (lp) lp.addEventListener('change', () => { m.querySelector('#cp-loc').value = lp.value; });
  }

  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = search.value.trim();
      if (q.length < 2) { results.style.display = 'none'; return; }
      const list = await api('/api/customers?q=' + encodeURIComponent(q)).catch(() => []);
      results.innerHTML = list.slice(0, 8).map((c) => `
        <div class="note" style="padding:8px 12px; cursor:pointer" data-c="${c.id}">
          <b>${esc(c.name)}</b> <span class="muted small">${esc(c.phone || '')} · ${esc((c.locations[0] || {}).address || 'no address')}</span></div>`).join('')
        || '<div class="empty small">No matches</div>';
      results.style.display = 'block';
      results.querySelectorAll('[data-c]').forEach((r) => r.addEventListener('click', () => choose(list.find((c) => c.id === r.dataset.c))));
    }, 200);
  });
  m.querySelector('#cp-new').addEventListener('click', () => newCustomerModal((c) => choose(c)));
  if (preset && preset.customerId) {
    api('/api/customers/' + preset.customerId).then((c) => choose(c, (c.locations || []).find((l) => l.id === preset.locationId)));
  }
}

async function newJobModal(preset) {
  const m = openModal(`${modalHead('New job')}
    <div class="modal-body">
      ${customerPicker()}
      ${jobCoreFields(null)}
      <div class="field"><label>Booking note</label><textarea id="jf-note" rows="2" placeholder="What did the customer describe?"></textarea></div>
    </div>${modalFoot('Create job', 'jf-create')}`);
  wireCustomerPicker(m, preset);
  m.querySelector('#jf-create').addEventListener('click', async () => {
    const customerId = m.querySelector('#cp-id').value;
    if (!customerId) return toast('Pick or create a customer first', true);
    try {
      const j = await api('/api/jobs', {
        method: 'POST',
        body: {
          customerId, locationId: m.querySelector('#cp-loc').value || null,
          tradeId: val('jf-trade'), jobTypeId: val('jf-type'), priority: val('jf-priority'),
          summary: val('jf-summary'), notes: val('jf-note'), ...readScheduleFields(),
        },
      });
      m.remove(); toast('Job #' + j.number + ' created');
      location.hash = '#/jobs/' + j.id;
    } catch (e) { oops(e); }
  });
}

// ---------------------------------------------------------------- customers

async function viewCustomers(q) {
  const list = await api('/api/customers' + (q ? '?q=' + encodeURIComponent(q) : ''));
  renderShell('customers', `
    <div class="page-head"><h1>Customers</h1><div class="spacer"></div>
      <input id="cust-q" placeholder="Search customers…" style="width:260px" value="${esc(q)}">
      <button class="btn primary" id="cust-new">+ New customer</button></div>
    <div class="card tight">${!list.length ? '<div class="empty">No customers yet</div>' : `
      <table class="list"><thead><tr><th>#</th><th>Name</th><th>Contact</th><th>Locations</th><th>Tags</th><th class="num">Jobs</th></tr></thead>
      <tbody>${list.map((c) => `
        <tr class="click" data-cust="${c.id}">
          <td class="muted">${c.number}</td>
          <td><b>${esc(c.name)}</b> <span class="muted small">${c.type}</span>${c.doNotService ? ' ' + pill('canceled').replace('canceled', 'DNS') : ''}</td>
          <td>${esc(c.phone)}<br><span class="small muted">${esc(c.email)}</span></td>
          <td class="small">${c.locations.map((l) => esc(l.address)).join('<br>') || '—'}</td>
          <td>${(c.tags || []).map((t) => `<span class="tagchip">${esc(t)}</span>`).join('')}</td>
          <td class="num">${c.jobCount}</td></tr>`).join('')}</tbody></table>`}</div>`);
  document.getElementById('cust-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = '#/customers?q=' + encodeURIComponent(e.target.value); });
  document.getElementById('cust-new').addEventListener('click', () => newCustomerModal());
  document.querySelectorAll('[data-cust]').forEach((r) => r.addEventListener('click', () => { location.hash = '#/customers/' + r.dataset.cust; }));
}

async function viewCustomer(id) {
  const c = await api('/api/customers/' + id);
  renderShell('customers', `
    <div class="page-head">
      <a href="#/customers" class="btn small">‹ Customers</a>
      <h1>${esc(c.name)}</h1><span class="muted">#${c.number} · ${c.type}</span>
      ${(c.tags || []).map((t) => `<span class="tagchip">${esc(t)}</span>`).join('')}
      <div class="spacer"></div>
      <button class="btn" id="c-edit">Edit</button>
      <button class="btn" id="c-est">+ Estimate</button>
      <button class="btn primary" id="c-job">+ Job</button>
    </div>
    <div class="two-col">
      <div>
        <div class="card">
          <h2>Contact</h2>
          <div class="row">
            <div><label>Phone</label>${esc(c.phone) || '—'}${c.altPhone ? `<div class="small muted">${esc(c.altPhone)}</div>` : ''}</div>
            <div><label>Email</label>${esc(c.email) || '—'}</div>
            <div><label>Lead source</label>${esc(c.leadSource) || '—'}</div>
          </div>
          ${c.notes ? `<div style="margin-top:10px"><label>Notes</label>${esc(c.notes)}</div>` : ''}
        </div>
        <div class="card tight">
          <h2>Locations <button class="btn small" id="c-add-loc" style="float:right; margin-top:-3px">+ Add</button></h2>
          ${c.locations.length ? `<table class="list"><tbody>${c.locations.map((l) => `
            <tr><td><b>${esc(l.name)}</b><br><span class="small">${esc([l.address, l.unit, l.city, l.state, l.zip].filter(Boolean).join(', '))}</span>
            ${l.gateCode ? `<span class="small muted"> · Gate: ${esc(l.gateCode)}</span>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No service locations</div>'}
        </div>
        <div class="card tight"><h2>Jobs</h2>${jobsTable(c.jobs.map((j) => ({ ...j, customerName: c.name, address: '' })))}</div>
      </div>
      <div>
        <div class="card tight"><h2>Estimates</h2>${miniList(c.estimates, 'estimates', (e) => `#${e.number} ${esc(e.name)} · ${money(e.total)} ${pill(e.status)}`)}</div>
        <div class="card tight"><h2>Invoices</h2>${miniList(c.invoices, 'invoices', (i) => `#${i.number} · ${money(i.total)} ${pill(i.status)}`)}</div>
      </div>
    </div>`);
  wireJobRows();
  document.getElementById('c-job').addEventListener('click', () => newJobModal({ customerId: c.id }));
  document.getElementById('c-est').addEventListener('click', () => newEstimateModal({ customerId: c.id }));
  document.getElementById('c-edit').addEventListener('click', () => editCustomerModal(c));
  document.getElementById('c-add-loc').addEventListener('click', () => {
    const m = openModal(`${modalHead('Add location')}<div class="modal-body">${locationFields({})}</div>${modalFoot('Add', 'loc-save')}`);
    m.querySelector('#loc-save').addEventListener('click', async () => {
      try {
        await api(`/api/customers/${c.id}/locations`, { method: 'POST', body: readLocationFields() });
        m.remove(); viewCustomer(c.id);
      } catch (e) { oops(e); }
    });
  });
}

function locationFields(l) {
  return `
    <div class="field"><label>Street address</label><input id="lf-address" value="${esc(l.address || '')}"></div>
    <div class="row">
      <div class="field"><label>Unit</label><input id="lf-unit" value="${esc(l.unit || '')}"></div>
      <div class="field"><label>City</label><input id="lf-city" value="${esc(l.city || '')}"></div>
      <div class="field"><label>State</label><input id="lf-state" value="${esc(l.state || '')}"></div>
      <div class="field"><label>ZIP</label><input id="lf-zip" value="${esc(l.zip || '')}"></div>
    </div>
    <div class="row">
      <div class="field"><label>Gate code</label><input id="lf-gate" value="${esc(l.gateCode || '')}"></div>
      <div class="field"><label>Location notes</label><input id="lf-notes" value="${esc(l.notes || '')}"></div>
    </div>`;
}
const readLocationFields = () => ({ address: val('lf-address'), unit: val('lf-unit'), city: val('lf-city'), state: val('lf-state'), zip: val('lf-zip'), gateCode: val('lf-gate'), locationNotes: val('lf-notes') });

function customerFields(c) {
  c = c || {};
  return `
    <div class="row">
      <div class="field" style="flex:2"><label>Name</label><input id="cf-name" value="${esc(c.name || '')}" placeholder="Full name or company"></div>
      <div class="field"><label>Type</label><select id="cf-type"><option value="residential" ${c.type !== 'commercial' ? 'selected' : ''}>Residential</option><option value="commercial" ${c.type === 'commercial' ? 'selected' : ''}>Commercial</option></select></div>
    </div>
    <div class="row">
      <div class="field"><label>Phone</label><input id="cf-phone" value="${esc(c.phone || '')}"></div>
      <div class="field"><label>Alt phone</label><input id="cf-alt" value="${esc(c.altPhone || '')}"></div>
      <div class="field"><label>Email</label><input id="cf-email" value="${esc(c.email || '')}"></div>
    </div>
    <div class="row">
      <div class="field"><label>Lead source</label><select id="cf-source"><option value="">—</option>${(App.settings.leadSources || []).map((s) => `<option ${c.leadSource === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
      <div class="field"><label>Tags</label><input id="cf-tags" value="${esc((c.tags || []).join(', '))}" placeholder="VIP, Member…"></div>
    </div>
    <div class="field"><label>Customer notes</label><textarea id="cf-notes" rows="2">${esc(c.notes || '')}</textarea></div>`;
}
const readCustomerFields = () => ({
  name: val('cf-name'), type: val('cf-type'), phone: val('cf-phone'), altPhone: val('cf-alt'), email: val('cf-email'),
  leadSource: val('cf-source'), notes: val('cf-notes'),
  tags: val('cf-tags').split(',').map((s) => s.trim()).filter(Boolean),
});

function newCustomerModal(onCreated) {
  const m = openModal(`${modalHead('New customer')}<div class="modal-body">${customerFields()}<h2 style="margin-top:8px">Service location</h2>${locationFields({})}</div>${modalFoot('Create customer', 'cf-save')}`);
  m.querySelector('#cf-save').addEventListener('click', async () => {
    try {
      const c = await api('/api/customers', { method: 'POST', body: { ...readCustomerFields(), ...readLocationFields() } });
      m.remove(); toast('Customer created');
      if (onCreated) onCreated(c);
      else location.hash = '#/customers/' + c.id;
    } catch (e) { oops(e); }
  });
}

function editCustomerModal(c) {
  const m = openModal(`${modalHead('Edit customer')}<div class="modal-body">${customerFields(c)}
    <label class="check"><input type="checkbox" id="cf-dns" ${c.doNotService ? 'checked' : ''}> Do not service</label>
  </div>${modalFoot('Save', 'cf-save')}`);
  m.querySelector('#cf-save').addEventListener('click', async () => {
    try {
      await api('/api/customers/' + c.id, { method: 'PUT', body: { ...readCustomerFields(), doNotService: m.querySelector('#cf-dns').checked } });
      m.remove(); toast('Saved'); viewCustomer(c.id);
    } catch (e) { oops(e); }
  });
}

// ---------------------------------------------------------------- estimates

async function viewEstimates(status) {
  const list = await api('/api/estimates' + (status ? '?status=' + status : ''));
  const tabs = ['', 'draft', 'sent', 'approved', 'declined'];
  renderShell('estimates', `
    <div class="page-head"><h1>Estimates</h1>
      <div class="status-bar">${tabs.map((t) => `<a class="btn small ${t === status ? 'on' : ''}" href="#/estimates${t ? '?status=' + t : ''}">${t || 'All'}</a>`).join('')}</div>
      <div class="spacer"></div><button class="btn primary" id="est-new">+ New estimate</button></div>
    <div class="card tight">${!list.length ? '<div class="empty">No estimates</div>' : `
      <table class="list"><thead><tr><th>#</th><th>Name</th><th>Customer</th><th>Job</th><th class="num">Total</th><th>Status</th><th>Created</th></tr></thead>
      <tbody>${list.map((e) => `
        <tr class="click" data-est="${e.id}">
          <td><b>#${e.number}</b></td><td>${esc(e.name)}</td><td>${esc(e.customerName)}</td>
          <td>${e.jobNumber ? '#' + e.jobNumber : '—'}</td>
          <td class="num">${money(e.total)}</td><td>${pill(e.status)}</td><td class="small muted">${fmtDate(e.createdAt)}</td></tr>`).join('')}</tbody></table>`}</div>`);
  document.getElementById('est-new').addEventListener('click', () => newEstimateModal());
  document.querySelectorAll('[data-est]').forEach((r) => r.addEventListener('click', () => { location.hash = '#/estimates/' + r.dataset.est; }));
}

function itemsEditorHtml(items) {
  return `
    <div class="row" style="margin-bottom:8px">
      <select id="ie-pick" style="flex:3">
        <option value="">Add from pricebook…</option>
        ${groupedPricebookOptions()}
      </select>
      <button class="btn" id="ie-add" style="flex:none">Add</button>
      <button class="btn" id="ie-custom" style="flex:none">+ Custom line</button>
    </div>
    <div style="overflow-x:auto"><table class="list items-editor" id="ie-table">
      <thead><tr><th style="width:44%">Item</th><th class="num">Qty</th><th class="num">Price</th><th>Tax</th><th class="num">Line</th><th></th></tr></thead>
      <tbody></tbody>
      <tfoot>
        <tr><td colspan="4" class="num muted">Subtotal</td><td class="num" id="ie-sub"></td><td></td></tr>
        <tr><td colspan="4" class="num muted">Tax (${App.settings.taxRatePct}%)</td><td class="num" id="ie-tax"></td><td></td></tr>
        <tr><td colspan="4" class="num"><b>Total</b></td><td class="num" id="ie-total"><b></b></td><td></td></tr>
      </tfoot>
    </table></div>`;
}

function groupedPricebookOptions() {
  const cats = {};
  for (const it of App.pricebook) (cats[it.category] = cats[it.category] || []).push(it);
  return Object.entries(cats).map(([cat, items]) => `<optgroup label="${esc(cat)}">${items.map((i) =>
    `<option value="${i.id}">${esc(i.code ? i.code + ' — ' : '')}${esc(i.name)} (${money(i.price)})</option>`).join('')}</optgroup>`).join('');
}

function wireItemsEditor(m, initial) {
  const items = (initial || []).map((x) => ({ ...x }));
  const tbody = m.querySelector('#ie-table tbody');

  function redraw() {
    tbody.innerHTML = items.map((it, i) => `
      <tr>
        <td><input data-i="${i}" data-k="name" value="${esc(it.name)}"><div class="small muted">${esc(it.code)}</div></td>
        <td><input data-i="${i}" data-k="qty" type="number" min="0" step="any" value="${it.qty}" style="width:64px" class="num"></td>
        <td><input data-i="${i}" data-k="price" type="number" min="0" step="0.01" value="${it.price}" style="width:92px" class="num"></td>
        <td><input data-i="${i}" data-k="taxable" type="checkbox" ${it.taxable ? 'checked' : ''} style="width:auto"></td>
        <td class="num">${money(it.qty * it.price)}</td>
        <td><button class="linklike" data-del="${i}">✕</button></td>
      </tr>`).join('') || '<tr><td colspan="6" class="empty small">No line items yet</td></tr>';
    let sub = 0, taxable = 0;
    for (const it of items) { const line = it.qty * it.price; sub += line; if (it.taxable) taxable += line; }
    const tax = taxable * (App.settings.taxRatePct / 100);
    m.querySelector('#ie-sub').textContent = money(sub);
    m.querySelector('#ie-tax').textContent = money(tax);
    m.querySelector('#ie-total').innerHTML = '<b>' + money(sub + tax) + '</b>';
    tbody.querySelectorAll('input[data-i]').forEach((inp) => inp.addEventListener('change', () => {
      const it = items[Number(inp.dataset.i)];
      if (inp.dataset.k === 'taxable') it.taxable = inp.checked;
      else if (inp.dataset.k === 'name') it.name = inp.value;
      else it[inp.dataset.k] = Number(inp.value) || 0;
      redraw();
    }));
    tbody.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { items.splice(Number(b.dataset.del), 1); redraw(); }));
  }

  m.querySelector('#ie-add').addEventListener('click', () => {
    const pb = App.pricebook.find((x) => x.id === m.querySelector('#ie-pick').value);
    if (!pb) return;
    items.push({ pricebookId: pb.id, code: pb.code, name: pb.name, description: pb.description, qty: 1, price: pb.price, taxable: pb.taxable });
    redraw();
  });
  m.querySelector('#ie-custom').addEventListener('click', () => {
    items.push({ pricebookId: null, code: '', name: 'Custom item', description: '', qty: 1, price: 0, taxable: false });
    redraw();
  });
  redraw();
  return () => items;
}

async function newEstimateModal(preset) {
  preset = preset || {};
  const asInvoice = !!preset.asInvoice;
  const m = openModal(`${modalHead(asInvoice ? 'New invoice' : 'New estimate')}
    <div class="modal-body">
      ${customerPicker()}
      ${asInvoice ? '' : `<div class="field"><label>Estimate name</label><input id="ef-name" placeholder="e.g. System replacement — Good option"></div>`}
      ${itemsEditorHtml()}
      ${asInvoice ? '' : `<div class="field" style="margin-top:12px"><label>Notes for customer</label><textarea id="ef-notes" rows="2"></textarea></div>`}
    </div>${modalFoot(asInvoice ? 'Create invoice' : 'Create estimate', 'ef-save')}`, true);
  wireCustomerPicker(m, preset);
  const getItems = wireItemsEditor(m, []);
  m.querySelector('#ef-save').addEventListener('click', async () => {
    const customerId = m.querySelector('#cp-id').value;
    if (!customerId) return toast('Pick or create a customer first', true);
    try {
      if (asInvoice) {
        const inv = await api('/api/invoices', { method: 'POST', body: { customerId, locationId: m.querySelector('#cp-loc').value || null, jobId: preset.jobId || null, items: getItems() } });
        m.remove(); toast('Invoice #' + inv.number + ' created');
        location.hash = '#/invoices/' + inv.id;
      } else {
        const e = await api('/api/estimates', {
          method: 'POST',
          body: { customerId, locationId: m.querySelector('#cp-loc').value || null, jobId: preset.jobId || null, name: val('ef-name') || 'Estimate', items: getItems(), notes: val('ef-notes') },
        });
        m.remove(); toast('Estimate #' + e.number + ' created');
        location.hash = '#/estimates/' + e.id;
      }
    } catch (e) { oops(e); }
  });
}

async function viewEstimate(id) {
  const e = await api('/api/estimates/' + id);
  const open = ['draft', 'sent'].includes(e.status);
  renderShell('estimates', `
    <div class="page-head">
      <a href="#/estimates" class="btn small">‹ Estimates</a>
      <h1>Estimate #${e.number} — ${esc(e.name)}</h1>${pill(e.status)}
      <div class="spacer"></div>
      ${open ? `<button class="btn" id="e-edit">Edit items</button>` : ''}
      ${e.status === 'draft' ? `<button class="btn" id="e-sent">Mark presented</button>` : ''}
      ${open ? `<button class="btn primary" id="e-approve">✓ Approve (sold)</button><button class="btn danger" id="e-decline">Decline</button>` : ''}
      ${e.status === 'approved' ? `<button class="btn accent" id="e-convert">Convert → Invoice</button>` : ''}
    </div>
    <div class="two-col">
      <div class="card tight">
        <h2>Line items</h2>
        <table class="list"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Line total</th></tr></thead>
        <tbody>${e.items.map((it) => `<tr><td><b>${esc(it.name)}</b>${it.code ? ` <span class="muted small">${esc(it.code)}</span>` : ''}<br><span class="small muted">${esc(it.description)}</span></td>
          <td class="num">${it.qty}</td><td class="num">${money(it.price)}</td><td class="num">${money(it.qty * it.price)}</td></tr>`).join('')}</tbody>
        <tfoot>
          <tr><td colspan="3" class="num muted">Subtotal</td><td class="num">${money(e.subtotal)}</td></tr>
          <tr><td colspan="3" class="num muted">Tax</td><td class="num">${money(e.tax)}</td></tr>
          <tr><td colspan="3" class="num"><b>Total</b></td><td class="num"><b>${money(e.total)}</b></td></tr>
        </tfoot></table>
      </div>
      <div>
        <div class="card">
          <h2>Info</h2>
          <div class="field"><label>Customer</label><a href="#/customers/${e.customerId}">${esc(e.customerName)}</a></div>
          ${e.jobNumber ? `<div class="field"><label>Job</label><a href="#/jobs/${e.jobId}">#${e.jobNumber}</a></div>` : ''}
          <div class="field"><label>Created</label>${fmtDT(e.createdAt)} by ${esc(userName(e.createdBy))}</div>
          ${e.soldBy ? `<div class="field"><label>Sold by</label>${esc(userName(e.soldBy))} on ${fmtDate(e.statusAt)}</div>` : ''}
          ${e.notes ? `<div class="field"><label>Notes</label>${esc(e.notes)}</div>` : ''}
        </div>
      </div>
    </div>`);
  const setStatus = async (status) => {
    try { await api('/api/estimates/' + e.id, { method: 'PUT', body: { status } }); toast('Estimate ' + status); viewEstimate(e.id); } catch (err) { oops(err); }
  };
  const on = (id2, fn) => { const b = document.getElementById(id2); if (b) b.addEventListener('click', fn); };
  on('e-sent', () => setStatus('sent'));
  on('e-approve', () => setStatus('approved'));
  on('e-decline', () => setStatus('declined'));
  on('e-edit', () => {
    const m = openModal(`${modalHead('Edit estimate #' + e.number)}<div class="modal-body">
      <div class="field"><label>Name</label><input id="ef-name" value="${esc(e.name)}"></div>${itemsEditorHtml()}</div>${modalFoot('Save', 'ef-save')}`, true);
    const getItems = wireItemsEditor(m, e.items);
    m.querySelector('#ef-save').addEventListener('click', async () => {
      try { await api('/api/estimates/' + e.id, { method: 'PUT', body: { name: val('ef-name'), items: getItems() } }); m.remove(); viewEstimate(e.id); } catch (err) { oops(err); }
    });
  });
  on('e-convert', () => {
    const m = openModal(`${modalHead('Convert estimate #' + e.number)}<div class="modal-body">
      <p>This creates an <b>invoice</b> for ${money(e.total)}.</p>
      <label class="check"><input type="checkbox" id="cv-job" ${e.jobId ? '' : 'checked'}> Also create a follow-up job to perform the work</label>
      <div id="cv-jobfields" style="margin-top:12px">${jobCoreFields({ summary: 'Sold: ' + e.name, priority: 'normal' })}</div>
    </div>${modalFoot('Convert', 'cv-go')}`);
    const jobCheck = m.querySelector('#cv-job');
    const fields = m.querySelector('#cv-jobfields');
    const sync = () => { fields.style.display = jobCheck.checked ? '' : 'none'; };
    jobCheck.addEventListener('change', sync); sync();
    m.querySelector('#cv-go').addEventListener('click', async () => {
      try {
        const body = { createJob: jobCheck.checked };
        if (jobCheck.checked) Object.assign(body, { tradeId: val('jf-trade'), jobTypeId: val('jf-type'), summary: val('jf-summary'), ...readScheduleFields() });
        const r = await api(`/api/estimates/${e.id}/convert`, { method: 'POST', body });
        m.remove(); toast('Invoice #' + r.invoice.number + ' created' + (r.job ? ' · Job #' + r.job.number : ''));
        location.hash = '#/invoices/' + r.invoice.id;
      } catch (err) { oops(err); }
    });
  });
}

// ---------------------------------------------------------------- invoices

async function viewInvoices(status) {
  const list = await api('/api/invoices' + (status ? '?status=' + status : ''));
  const tabs = ['', 'draft', 'sent', 'paid', 'void'];
  renderShell('invoices', `
    <div class="page-head"><h1>Invoices</h1>
      <div class="status-bar">${tabs.map((t) => `<a class="btn small ${t === status ? 'on' : ''}" href="#/invoices${t ? '?status=' + t : ''}">${t || 'All'}</a>`).join('')}</div>
      <div class="spacer"></div></div>
    <div class="card tight">${!list.length ? '<div class="empty">No invoices — convert an approved estimate or add one from a job</div>' : `
      <table class="list"><thead><tr><th>#</th><th>Customer</th><th>Job</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th><th>Created</th></tr></thead>
      <tbody>${list.map((i) => `
        <tr class="click" data-inv="${i.id}">
          <td><b>#${i.number}</b></td><td>${esc(i.customerName)}</td><td>${i.jobNumber ? '#' + i.jobNumber : '—'}</td>
          <td class="num">${money(i.total)}</td><td class="num">${money(i.balance)}</td>
          <td>${pill(i.status)}</td><td class="small muted">${fmtDate(i.createdAt)}</td></tr>`).join('')}</tbody></table>`}</div>`);
  document.querySelectorAll('[data-inv]').forEach((r) => r.addEventListener('click', () => { location.hash = '#/invoices/' + r.dataset.inv; }));
}

async function viewInvoice(id) {
  const list = await api('/api/invoices');
  const i = list.find((x) => x.id === id);
  if (!i) return toast('Invoice not found', true);
  const openInv = ['draft', 'sent'].includes(i.status);
  renderShell('invoices', `
    <div class="page-head">
      <a href="#/invoices" class="btn small">‹ Invoices</a>
      <h1>Invoice #${i.number}</h1>${pill(i.status)}
      <div class="spacer"></div>
      ${openInv ? `<button class="btn" id="i-sent" ${i.status === 'sent' ? 'disabled' : ''}>Mark sent</button>
      <button class="btn primary" id="i-pay">Record payment</button>
      <button class="btn danger" id="i-void">Void</button>` : ''}
    </div>
    <div class="two-col">
      <div class="card tight">
        <h2>Line items</h2>
        <table class="list"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Line total</th></tr></thead>
        <tbody>${i.items.map((it) => `<tr><td><b>${esc(it.name)}</b><br><span class="small muted">${esc(it.description)}</span></td>
          <td class="num">${it.qty}</td><td class="num">${money(it.price)}</td><td class="num">${money(it.qty * it.price)}</td></tr>`).join('')}</tbody>
        <tfoot>
          <tr><td colspan="3" class="num muted">Subtotal</td><td class="num">${money(i.subtotal)}</td></tr>
          <tr><td colspan="3" class="num muted">Tax</td><td class="num">${money(i.tax)}</td></tr>
          <tr><td colspan="3" class="num"><b>Total</b></td><td class="num"><b>${money(i.total)}</b></td></tr>
          <tr><td colspan="3" class="num muted">Payments</td><td class="num">− ${money(i.total - i.balance)}</td></tr>
          <tr><td colspan="3" class="num"><b>Balance due</b></td><td class="num"><b>${money(i.balance)}</b></td></tr>
        </tfoot></table>
      </div>
      <div>
        <div class="card">
          <h2>Info</h2>
          <div class="field"><label>Customer</label><a href="#/customers/${i.customerId}">${esc(i.customerName)}</a></div>
          ${i.jobNumber ? `<div class="field"><label>Job</label><a href="#/jobs/${i.jobId}">#${i.jobNumber}</a></div>` : ''}
          <div class="field"><label>Created</label>${fmtDT(i.createdAt)}</div>
        </div>
        <div class="card tight"><h2>Payments</h2>
          ${i.payments.length ? `<table class="list"><tbody>${i.payments.map((p) => `
            <tr><td>${money(p.amount)} <span class="muted small">${esc(p.method)}${p.reference ? ' · ' + esc(p.reference) : ''}</span><br>
            <span class="small muted">${fmtDT(p.at)} by ${esc(userName(p.userId))}</span></td></tr>`).join('')}</tbody></table>` : '<div class="empty small">No payments</div>'}
        </div>
      </div>
    </div>`);
  const on = (id2, fn) => { const b = document.getElementById(id2); if (b) b.addEventListener('click', fn); };
  on('i-sent', async () => { try { await api('/api/invoices/' + i.id, { method: 'PUT', body: { status: 'sent' } }); viewInvoice(i.id); } catch (e) { oops(e); } });
  on('i-void', async () => {
    if (!confirm('Void this invoice?')) return;
    try { await api('/api/invoices/' + i.id, { method: 'PUT', body: { status: 'void' } }); viewInvoice(i.id); } catch (e) { oops(e); }
  });
  on('i-pay', () => {
    const m = openModal(`${modalHead('Record payment — invoice #' + i.number)}<div class="modal-body">
      <div class="row">
        <div class="field"><label>Amount</label><input id="pf-amount" type="number" step="0.01" value="${i.balance}"></div>
        <div class="field"><label>Method</label><select id="pf-method">${['cash', 'check', 'card', 'financing', 'other'].map((x) => `<option>${x}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Reference / check #</label><input id="pf-ref"></div>
    </div>${modalFoot('Record payment', 'pf-save')}`);
    m.querySelector('#pf-save').addEventListener('click', async () => {
      try {
        await api(`/api/invoices/${i.id}/payments`, { method: 'POST', body: { amount: Number(val('pf-amount')), method: val('pf-method'), reference: val('pf-ref') } });
        m.remove(); toast('Payment recorded'); viewInvoice(i.id);
      } catch (e) { oops(e); }
    });
  });
}

// ---------------------------------------------------------------- pricebook

async function viewPricebook() {
  const canEdit = App.me.role !== 'technician';
  const cats = {};
  for (const it of App.pricebook) (cats[it.category] = cats[it.category] || []).push(it);
  renderShell('pricebook', `
    <div class="page-head"><h1>Pricebook</h1><div class="spacer"></div>
      ${canEdit ? '<button class="btn primary" id="pb-new">+ New item</button>' : ''}</div>
    ${Object.entries(cats).map(([cat, items]) => `
      <div class="card tight"><h2>${esc(cat)}</h2>
        <table class="list"><thead><tr><th>Code</th><th>Item</th><th>Type</th><th>Trade</th><th class="num">Price</th><th class="num">Member</th><th class="num">Cost</th>${canEdit ? '<th></th>' : ''}</tr></thead>
        <tbody>${items.map((it) => `
          <tr><td class="muted">${esc(it.code)}</td>
          <td><b>${esc(it.name)}</b><br><span class="small muted">${esc(it.description)}</span></td>
          <td>${esc(it.type)}</td><td>${it.tradeId ? esc(tradeName(it.tradeId)) : '<span class="muted">all</span>'}</td>
          <td class="num">${money(it.price)}</td><td class="num">${money(it.memberPrice)}</td><td class="num">${money(it.cost)}</td>
          ${canEdit ? `<td><button class="linklike" data-edit="${it.id}">Edit</button></td>` : ''}</tr>`).join('')}</tbody></table>
      </div>`).join('') || '<div class="card empty">Pricebook is empty</div>'}`);
  if (!canEdit) return;
  document.getElementById('pb-new').addEventListener('click', () => pricebookItemModal(null));
  document.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => pricebookItemModal(App.pricebook.find((x) => x.id === b.dataset.edit))));
}

function pricebookItemModal(it) {
  const isNew = !it;
  it = it || { taxable: false, type: 'service' };
  const m = openModal(`${modalHead(isNew ? 'New pricebook item' : 'Edit item')}<div class="modal-body">
    <div class="row">
      <div class="field"><label>Code</label><input id="pb-code" value="${esc(it.code || '')}"></div>
      <div class="field" style="flex:2"><label>Name</label><input id="pb-name" value="${esc(it.name || '')}"></div>
    </div>
    <div class="field"><label>Description</label><input id="pb-desc" value="${esc(it.description || '')}"></div>
    <div class="row">
      <div class="field"><label>Category</label><input id="pb-cat" value="${esc(it.category || '')}" list="pb-cats"></div>
      <datalist id="pb-cats">${[...new Set(App.pricebook.map((x) => x.category))].map((c) => `<option>${esc(c)}</option>`).join('')}</datalist>
      <div class="field"><label>Type</label><select id="pb-type"><option ${it.type === 'service' ? 'selected' : ''}>service</option><option ${it.type === 'material' ? 'selected' : ''}>material</option></select></div>
      <div class="field"><label>Trade</label><select id="pb-trade"><option value="">All trades</option>${selectOptions(App.settings.trades || [], 'id', 'name', it.tradeId)}</select></div>
    </div>
    <div class="row">
      <div class="field"><label>Price</label><input id="pb-price" type="number" step="0.01" value="${it.price || 0}"></div>
      <div class="field"><label>Member price</label><input id="pb-mprice" type="number" step="0.01" value="${it.memberPrice || 0}"></div>
      <div class="field"><label>Cost</label><input id="pb-cost" type="number" step="0.01" value="${it.cost || 0}"></div>
    </div>
    <label class="check"><input type="checkbox" id="pb-taxable" ${it.taxable ? 'checked' : ''}> Taxable</label>
    ${!isNew ? `<label class="check" style="margin-top:8px"><input type="checkbox" id="pb-active" ${it.active !== false ? 'checked' : ''}> Active (visible in pickers)</label>` : ''}
  </div>${modalFoot('Save', 'pb-save')}`);
  m.querySelector('#pb-save').addEventListener('click', async () => {
    const body = {
      code: val('pb-code'), name: val('pb-name'), description: val('pb-desc'), category: val('pb-cat') || 'General',
      type: val('pb-type'), tradeId: val('pb-trade') || null,
      price: Number(val('pb-price')), memberPrice: Number(val('pb-mprice')), cost: Number(val('pb-cost')),
      taxable: m.querySelector('#pb-taxable').checked,
    };
    if (!isNew) body.active = m.querySelector('#pb-active').checked;
    try {
      await api(isNew ? '/api/pricebook' : '/api/pricebook/' + it.id, { method: isNew ? 'POST' : 'PUT', body });
      const b = await api('/api/bootstrap'); Object.assign(App, b);
      m.remove(); toast('Saved'); viewPricebook();
    } catch (e) { oops(e); }
  });
}

// ---------------------------------------------------------------- settings

async function viewSettings() {
  const isAdmin = App.me.role === 'admin';
  const s = App.settings;
  renderShell('settings', `
    <div class="page-head"><h1>Settings</h1></div>
    <div class="two-col">
      <div>
        <div class="card">
          <h2>Company</h2>
          <div class="row">
            <div class="field"><label>Company name</label><input id="s-company" value="${esc(s.companyName)}" ${isAdmin ? '' : 'disabled'}></div>
            <div class="field"><label>Tax rate %</label><input id="s-tax" type="number" step="0.01" value="${s.taxRatePct}" ${isAdmin ? '' : 'disabled'}></div>
          </div>
          <div class="row">
            <div class="field"><label>Day starts (hour 0–23)</label><input id="s-bh-start" type="number" min="0" max="23" value="${(s.businessHours || {}).start ?? 7}" ${isAdmin ? '' : 'disabled'}></div>
            <div class="field"><label>Day ends</label><input id="s-bh-end" type="number" min="1" max="24" value="${(s.businessHours || {}).end ?? 19}" ${isAdmin ? '' : 'disabled'}></div>
          </div>
        </div>
        <div class="card">
          <h2>Trades (business units)</h2>
          <p class="small muted">Service Colossus is trade-agnostic — add whichever trades this company runs. Each gets a color on the dispatch board.</p>
          <div id="s-trades">${(s.trades || []).map((t, i) => `
            <div class="row" style="margin-bottom:8px">
              <input data-trade-name="${i}" value="${esc(t.name)}" ${isAdmin ? '' : 'disabled'}>
              <input data-trade-color="${i}" type="color" value="${esc(t.color || '#0f4c81')}" style="width:60px; flex:none; padding:2px" ${isAdmin ? '' : 'disabled'}>
              ${isAdmin ? `<button class="linklike" data-trade-del="${i}" style="flex:none">✕</button>` : ''}
            </div>`).join('')}</div>
          ${isAdmin ? '<button class="btn small" id="s-trade-add">+ Add trade</button>' : ''}
        </div>
        <div class="card">
          <h2>Job types</h2>
          <div id="s-jobtypes">${(s.jobTypes || []).map((t, i) => `
            <div class="row" style="margin-bottom:8px">
              <input data-jt-name="${i}" value="${esc(t.name)}" ${isAdmin ? '' : 'disabled'}>
              <input data-jt-dur="${i}" type="number" value="${t.durationMin || 60}" title="default minutes" style="width:100px; flex:none" ${isAdmin ? '' : 'disabled'}>
              ${isAdmin ? `<button class="linklike" data-jt-del="${i}" style="flex:none">✕</button>` : ''}
            </div>`).join('')}</div>
          ${isAdmin ? '<button class="btn small" id="s-jt-add">+ Add job type</button>' : ''}
        </div>
        ${isAdmin ? '<button class="btn primary" id="s-save">Save settings</button>' : ''}
      </div>
      <div>
        <div class="card tight">
          <h2>Team ${isAdmin ? '<button class="btn small" id="s-user-add" style="float:right; margin-top:-3px">+ Add user</button>' : ''}</h2>
          <table class="list"><tbody>${App.users.map((u) => `
            <tr><td><span class="avatar" style="background:${esc(u.color || '#495057')}">${esc(u.name.slice(0, 2).toUpperCase())}</span></td>
            <td><b>${esc(u.name)}</b>${u.active === false ? ' <span class="pill void">inactive</span>' : ''}<br><span class="small muted">${esc(u.email)}</span></td>
            <td>${pill(u.role)}</td>
            ${isAdmin ? `<td><button class="linklike" data-user="${u.id}">Edit</button></td>` : ''}</tr>`).join('')}</tbody></table>
        </div>
      </div>
    </div>`);
  if (!isAdmin) return;

  const collectAndSave = async (mutate) => {
    const trades = [...document.querySelectorAll('[data-trade-name]')].map((inp, i) => ({
      id: (s.trades[i] || {}).id, name: inp.value,
      color: document.querySelector(`[data-trade-color="${i}"]`).value,
    })).filter((t) => t.name.trim());
    const jobTypes = [...document.querySelectorAll('[data-jt-name]')].map((inp, i) => ({
      id: (s.jobTypes[i] || {}).id, name: inp.value,
      durationMin: Number(document.querySelector(`[data-jt-dur="${i}"]`).value) || 60,
    })).filter((t) => t.name.trim());
    const body = {
      companyName: val('s-company'), taxRatePct: Number(val('s-tax')) || 0,
      businessHours: { start: Number(val('s-bh-start')) || 7, end: Number(val('s-bh-end')) || 19 },
      trades, jobTypes,
    };
    if (mutate) mutate(body);
    try {
      App.settings = await api('/api/settings', { method: 'PUT', body });
      toast('Settings saved'); viewSettings();
    } catch (e) { oops(e); }
  };

  document.getElementById('s-save').addEventListener('click', () => collectAndSave());
  document.getElementById('s-trade-add').addEventListener('click', () => collectAndSave((b) => b.trades.push({ name: 'New Trade', color: '#0f4c81' })));
  document.getElementById('s-jt-add').addEventListener('click', () => collectAndSave((b) => b.jobTypes.push({ name: 'New Job Type', durationMin: 60 })));
  document.querySelectorAll('[data-trade-del]').forEach((b) => b.addEventListener('click', () => collectAndSave((body) => body.trades.splice(Number(b.dataset.tradeDel), 1))));
  document.querySelectorAll('[data-jt-del]').forEach((b) => b.addEventListener('click', () => collectAndSave((body) => body.jobTypes.splice(Number(b.dataset.jtDel), 1))));
  document.getElementById('s-user-add').addEventListener('click', () => userModal(null));
  document.querySelectorAll('[data-user]').forEach((b) => b.addEventListener('click', () => userModal(App.users.find((u) => u.id === b.dataset.user))));
}

function userModal(u) {
  const isNew = !u;
  u = u || { role: 'technician', color: '#2b8a3e', active: true };
  const m = openModal(`${modalHead(isNew ? 'Add user' : 'Edit user')}<div class="modal-body">
    <div class="row">
      <div class="field"><label>Name</label><input id="uf-name" value="${esc(u.name || '')}"></div>
      <div class="field"><label>Email</label><input id="uf-email" value="${esc(u.email || '')}"></div>
    </div>
    <div class="row">
      <div class="field"><label>Role</label><select id="uf-role">${['admin', 'dispatcher', 'technician'].map((r) => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div class="field"><label>Color</label><input id="uf-color" type="color" value="${esc(u.color || '#2b8a3e')}" style="padding:2px; height:36px"></div>
    </div>
    <div class="field"><label>${isNew ? 'Password' : 'New password (leave blank to keep)'}</label><input id="uf-pass" type="password" autocomplete="new-password"></div>
    ${!isNew ? `<label class="check"><input type="checkbox" id="uf-active" ${u.active !== false ? 'checked' : ''}> Active</label>` : ''}
  </div>${modalFoot('Save', 'uf-save')}`);
  m.querySelector('#uf-save').addEventListener('click', async () => {
    const body = { name: val('uf-name'), email: val('uf-email'), role: val('uf-role'), color: val('uf-color') };
    if (val('uf-pass')) body.password = val('uf-pass');
    if (!isNew) body.active = m.querySelector('#uf-active').checked;
    try {
      await api(isNew ? '/api/users' : '/api/users/' + u.id, { method: isNew ? 'POST' : 'PUT', body });
      const b = await api('/api/bootstrap'); Object.assign(App, b);
      m.remove(); toast('Saved'); viewSettings();
    } catch (e) { oops(e); }
  });
}

// ---------------------------------------------------------------- start

(async () => {
  try {
    const b = await api('/api/bootstrap');
    Object.assign(App, b);
    route();
  } catch (e) { /* renderLogin already called on 401 */ }
})();
