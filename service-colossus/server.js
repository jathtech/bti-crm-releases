'use strict';
// Service Colossus — trade-agnostic field service management server.
// Zero-dependency Node.js: HTTP server, REST API, cookie sessions, static SPA.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/store');

const PORT = Number(process.env.PORT || 4180);
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

store.load();
const S = store.state;

// ---------------------------------------------------------------- helpers

function send(res, code, body, headers) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers));
  res.end(data);
}
const ok = (res, body) => send(res, 200, body);
const bad = (res, msg) => send(res, 400, { error: msg });
const notFound = (res) => send(res, 404, { error: 'Not found' });
const forbidden = (res) => send(res, 403, { error: 'Forbidden' });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2e6) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function getSessionUser(req) {
  const token = parseCookies(req).colossus_session;
  if (!token) return null;
  const sess = S.sessions.find((s) => s.token === token);
  if (!sess || Date.parse(sess.expires) < Date.now()) return null;
  const user = S.users.find((u) => u.id === sess.userId && u.active !== false);
  return user || null;
}

function publicUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}

function computeTotals(items, taxRatePct) {
  let subtotal = 0, taxable = 0;
  for (const it of items || []) {
    const line = (Number(it.price) || 0) * (Number(it.qty) || 0);
    subtotal += line;
    if (it.taxable) taxable += line;
  }
  const tax = Math.round(taxable * (taxRatePct / 100) * 100) / 100;
  subtotal = Math.round(subtotal * 100) / 100;
  return { subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100 };
}

function cleanItems(items) {
  return (Array.isArray(items) ? items : []).map((it) => ({
    pricebookId: it.pricebookId || null,
    code: String(it.code || ''),
    name: String(it.name || 'Item'),
    description: String(it.description || ''),
    qty: Number(it.qty) || 1,
    price: Number(it.price) || 0,
    taxable: !!it.taxable,
  }));
}

const JOB_STATUSES = ['scheduled', 'dispatched', 'in-progress', 'on-hold', 'completed', 'canceled'];
const EST_STATUSES = ['draft', 'sent', 'approved', 'declined', 'expired'];
const INV_STATUSES = ['draft', 'sent', 'paid', 'void'];

// ---------------------------------------------------------------- API

const routes = [];
function route(method, pattern, handler, opts) {
  // pattern like '/api/jobs/:id'
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, rx, keys, handler, opts: opts || {} });
}

// --- auth
route('POST', '/api/login', async (req, res, params, body) => {
  const user = S.users.find((u) => u.email.toLowerCase() === String(body.email || '').toLowerCase() && u.active !== false);
  if (!user || !store.verifyPassword(String(body.password || ''), user.password)) {
    return send(res, 401, { error: 'Invalid email or password' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  S.sessions = S.sessions.filter((s) => Date.parse(s.expires) > Date.now());
  S.sessions.push({ token, userId: user.id, expires: new Date(Date.now() + SESSION_TTL_MS).toISOString() });
  store.markDirty('sessions');
  send(res, 200, { user: publicUser(user) }, {
    'Set-Cookie': `colossus_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`,
  });
}, { public: true });

route('POST', '/api/logout', async (req, res) => {
  const token = parseCookies(req).colossus_session;
  S.sessions = S.sessions.filter((s) => s.token !== token);
  store.markDirty('sessions');
  send(res, 200, { ok: true }, { 'Set-Cookie': 'colossus_session=; Path=/; HttpOnly; Max-Age=0' });
}, { public: true });

route('GET', '/api/bootstrap', async (req, res, p, b, user) => {
  ok(res, {
    user: publicUser(user),
    settings: S.settings,
    users: S.users.map(publicUser),
    pricebook: S.pricebook.filter((i) => i.active !== false),
  });
});

// --- settings & users (admin)
route('PUT', '/api/settings', async (req, res, p, body, user) => {
  if (user.role !== 'admin') return forbidden(res);
  const allowed = ['companyName', 'taxRatePct', 'currency', 'trades', 'jobTypes', 'tagTypes', 'leadSources', 'businessHours'];
  for (const k of allowed) if (k in body) S.settings[k] = body[k];
  for (const list of ['trades', 'jobTypes']) {
    for (const item of S.settings[list] || []) if (!item.id) item.id = store.id();
  }
  store.markDirty('settings');
  store.logActivity(user.id, 'updated', 'settings', null, '');
  ok(res, S.settings);
});

route('POST', '/api/users', async (req, res, p, body, user) => {
  if (user.role !== 'admin') return forbidden(res);
  if (!body.name || !body.email || !body.password) return bad(res, 'name, email and password are required');
  if (S.users.some((u) => u.email.toLowerCase() === body.email.toLowerCase())) return bad(res, 'A user with that email already exists');
  const u = {
    id: store.id(), name: String(body.name), email: String(body.email),
    role: ['admin', 'dispatcher', 'technician'].includes(body.role) ? body.role : 'technician',
    password: store.hashPassword(String(body.password)), active: true,
    color: body.color || '#495057',
  };
  S.users.push(u);
  store.markDirty('users');
  store.logActivity(user.id, 'created', 'user', u.id, u.name);
  ok(res, publicUser(u));
});

route('PUT', '/api/users/:id', async (req, res, params, body, user) => {
  if (user.role !== 'admin' && user.id !== params.id) return forbidden(res);
  const u = S.users.find((x) => x.id === params.id);
  if (!u) return notFound(res);
  for (const k of ['name', 'email', 'color']) if (k in body) u[k] = String(body[k]);
  if (user.role === 'admin') {
    if ('role' in body && ['admin', 'dispatcher', 'technician'].includes(body.role)) u.role = body.role;
    if ('active' in body) u.active = !!body.active;
  }
  if (body.password) u.password = store.hashPassword(String(body.password));
  store.markDirty('users');
  ok(res, publicUser(u));
});

// --- customers & locations
route('GET', '/api/customers', async (req, res, p, b, user, url) => {
  const q = (url.searchParams.get('q') || '').toLowerCase();
  let list = S.customers;
  if (q) {
    list = list.filter((c) =>
      [c.name, c.phone, c.email, String(c.number)].some((v) => String(v || '').toLowerCase().includes(q)) ||
      S.locations.some((l) => l.customerId === c.id && String(l.address || '').toLowerCase().includes(q)));
  }
  ok(res, list.slice(0, 200).map((c) => ({
    ...c,
    locations: S.locations.filter((l) => l.customerId === c.id),
    jobCount: S.jobs.filter((j) => j.customerId === c.id).length,
  })));
});

route('POST', '/api/customers', async (req, res, p, body, user) => {
  if (!body.name) return bad(res, 'Customer name is required');
  const c = {
    id: store.id(), number: store.nextNumber('customer'),
    name: String(body.name), type: body.type === 'commercial' ? 'commercial' : 'residential',
    phone: String(body.phone || ''), altPhone: String(body.altPhone || ''), email: String(body.email || ''),
    leadSource: String(body.leadSource || ''), tags: Array.isArray(body.tags) ? body.tags : [],
    notes: String(body.notes || ''), doNotService: false,
    createdAt: new Date().toISOString(), createdBy: user.id,
  };
  S.customers.unshift(c);
  store.markDirty('customers');
  let loc = null;
  if (body.address) {
    loc = addLocation(c.id, body, user);
  }
  store.logActivity(user.id, 'created', 'customer', c.id, c.name);
  ok(res, { ...c, locations: loc ? [loc] : [] });
});

function addLocation(customerId, body, user) {
  const l = {
    id: store.id(), customerId,
    name: String(body.locationName || body.address || 'Primary'),
    address: String(body.address || ''), unit: String(body.unit || ''),
    city: String(body.city || ''), state: String(body.state || ''), zip: String(body.zip || ''),
    gateCode: String(body.gateCode || ''), notes: String(body.locationNotes || ''),
    createdAt: new Date().toISOString(),
  };
  S.locations.push(l);
  store.markDirty('locations');
  return l;
}

route('GET', '/api/customers/:id', async (req, res, params) => {
  const c = S.customers.find((x) => x.id === params.id);
  if (!c) return notFound(res);
  ok(res, {
    ...c,
    locations: S.locations.filter((l) => l.customerId === c.id),
    jobs: S.jobs.filter((j) => j.customerId === c.id),
    estimates: S.estimates.filter((e) => e.customerId === c.id),
    invoices: S.invoices.filter((i) => i.customerId === c.id),
  });
});

route('PUT', '/api/customers/:id', async (req, res, params, body, user) => {
  const c = S.customers.find((x) => x.id === params.id);
  if (!c) return notFound(res);
  for (const k of ['name', 'phone', 'altPhone', 'email', 'leadSource', 'notes']) if (k in body) c[k] = String(body[k]);
  if ('type' in body) c.type = body.type === 'commercial' ? 'commercial' : 'residential';
  if ('tags' in body && Array.isArray(body.tags)) c.tags = body.tags;
  if ('doNotService' in body) c.doNotService = !!body.doNotService;
  store.markDirty('customers');
  store.logActivity(user.id, 'updated', 'customer', c.id, c.name);
  ok(res, c);
});

route('POST', '/api/customers/:id/locations', async (req, res, params, body, user) => {
  const c = S.customers.find((x) => x.id === params.id);
  if (!c) return notFound(res);
  if (!body.address) return bad(res, 'Address is required');
  ok(res, addLocation(c.id, body, user));
});

route('PUT', '/api/locations/:id', async (req, res, params, body) => {
  const l = S.locations.find((x) => x.id === params.id);
  if (!l) return notFound(res);
  for (const k of ['name', 'address', 'unit', 'city', 'state', 'zip', 'gateCode', 'notes']) if (k in body) l[k] = String(body[k]);
  store.markDirty('locations');
  ok(res, l);
});

// --- jobs
route('GET', '/api/jobs', async (req, res, p, b, user, url) => {
  const sp = url.searchParams;
  let list = S.jobs;
  if (sp.get('status')) list = list.filter((j) => j.status === sp.get('status'));
  if (sp.get('techId')) list = list.filter((j) => (j.techIds || []).includes(sp.get('techId')));
  if (sp.get('tradeId')) list = list.filter((j) => j.tradeId === sp.get('tradeId'));
  if (sp.get('from')) list = list.filter((j) => j.start && j.start >= sp.get('from'));
  if (sp.get('to')) list = list.filter((j) => j.start && j.start <= sp.get('to') + 'T23:59:59');
  const q = (sp.get('q') || '').toLowerCase();
  if (q) {
    list = list.filter((j) => {
      const c = S.customers.find((x) => x.id === j.customerId);
      return String(j.number).includes(q) || (j.summary || '').toLowerCase().includes(q) ||
        (c && c.name.toLowerCase().includes(q));
    });
  }
  ok(res, list.slice(0, 500).map(expandJob));
});

function expandJob(j) {
  const c = S.customers.find((x) => x.id === j.customerId);
  const l = S.locations.find((x) => x.id === j.locationId);
  return {
    ...j,
    customerName: c ? c.name : '(deleted)',
    customerPhone: c ? c.phone : '',
    address: l ? [l.address, l.unit, l.city, l.state, l.zip].filter(Boolean).join(', ') : '',
  };
}

route('POST', '/api/jobs', async (req, res, p, body, user) => {
  const c = S.customers.find((x) => x.id === body.customerId);
  if (!c) return bad(res, 'A valid customer is required');
  if (c.doNotService) return bad(res, 'Customer is flagged Do Not Service');
  const jt = (S.settings.jobTypes || []).find((t) => t.id === body.jobTypeId);
  const j = {
    id: store.id(), number: store.nextNumber('job'),
    customerId: c.id, locationId: body.locationId || (S.locations.find((l) => l.customerId === c.id) || {}).id || null,
    tradeId: body.tradeId || null, jobTypeId: body.jobTypeId || null,
    summary: String(body.summary || (jt ? jt.name : 'Job')),
    priority: ['low', 'normal', 'high', 'urgent'].includes(body.priority) ? body.priority : 'normal',
    status: 'scheduled',
    start: body.start || null, end: body.end || null,
    techIds: Array.isArray(body.techIds) ? body.techIds : [],
    tags: Array.isArray(body.tags) ? body.tags : [],
    leadSource: String(body.leadSource || c.leadSource || ''),
    notes: [], createdAt: new Date().toISOString(), createdBy: user.id,
  };
  if (body.notes) j.notes.push({ id: store.id(), at: j.createdAt, userId: user.id, text: String(body.notes) });
  S.jobs.unshift(j);
  store.markDirty('jobs');
  store.logActivity(user.id, 'created', 'job', j.id, `#${j.number} ${j.summary}`);
  ok(res, expandJob(j));
});

route('GET', '/api/jobs/:id', async (req, res, params) => {
  const j = S.jobs.find((x) => x.id === params.id);
  if (!j) return notFound(res);
  ok(res, {
    ...expandJob(j),
    customer: S.customers.find((x) => x.id === j.customerId) || null,
    location: S.locations.find((x) => x.id === j.locationId) || null,
    estimates: S.estimates.filter((e) => e.jobId === j.id),
    invoices: S.invoices.filter((i) => i.jobId === j.id),
  });
});

route('PUT', '/api/jobs/:id', async (req, res, params, body, user) => {
  const j = S.jobs.find((x) => x.id === params.id);
  if (!j) return notFound(res);
  if (user.role === 'technician' && !(j.techIds || []).includes(user.id)) return forbidden(res);
  if ('status' in body) {
    if (!JOB_STATUSES.includes(body.status)) return bad(res, 'Invalid status');
    if (j.status !== body.status) {
      j.status = body.status;
      store.logActivity(user.id, 'status → ' + body.status, 'job', j.id, `#${j.number}`);
    }
  }
  for (const k of ['summary', 'leadSource']) if (k in body) j[k] = String(body[k]);
  if ('priority' in body && ['low', 'normal', 'high', 'urgent'].includes(body.priority)) j.priority = body.priority;
  for (const k of ['start', 'end', 'tradeId', 'jobTypeId', 'locationId']) if (k in body) j[k] = body[k] || null;
  if ('techIds' in body && Array.isArray(body.techIds)) j.techIds = body.techIds;
  if ('tags' in body && Array.isArray(body.tags)) j.tags = body.tags;
  if (body.addNote) j.notes.push({ id: store.id(), at: new Date().toISOString(), userId: user.id, text: String(body.addNote) });
  store.markDirty('jobs');
  ok(res, expandJob(j));
});

// --- estimates
route('GET', '/api/estimates', async (req, res, p, b, u, url) => {
  let list = S.estimates;
  const st = url.searchParams.get('status');
  if (st) list = list.filter((e) => e.status === st);
  ok(res, list.slice(0, 500).map(expandEstimate));
});

function expandEstimate(e) {
  const c = S.customers.find((x) => x.id === e.customerId);
  const j = S.jobs.find((x) => x.id === e.jobId);
  return { ...e, customerName: c ? c.name : '(deleted)', jobNumber: j ? j.number : null };
}

route('POST', '/api/estimates', async (req, res, p, body, user) => {
  const c = S.customers.find((x) => x.id === body.customerId);
  if (!c) return bad(res, 'A valid customer is required');
  const items = cleanItems(body.items);
  const e = {
    id: store.id(), number: store.nextNumber('estimate'),
    customerId: c.id, locationId: body.locationId || null, jobId: body.jobId || null,
    name: String(body.name || 'Estimate'), status: 'draft',
    items, ...computeTotals(items, S.settings.taxRatePct),
    validUntil: body.validUntil || null, notes: String(body.notes || ''),
    createdAt: new Date().toISOString(), createdBy: user.id, soldBy: null, statusAt: null,
  };
  S.estimates.unshift(e);
  store.markDirty('estimates');
  store.logActivity(user.id, 'created', 'estimate', e.id, `#${e.number} ${e.name}`);
  ok(res, expandEstimate(e));
});

route('GET', '/api/estimates/:id', async (req, res, params) => {
  const e = S.estimates.find((x) => x.id === params.id);
  if (!e) return notFound(res);
  ok(res, {
    ...expandEstimate(e),
    customer: S.customers.find((x) => x.id === e.customerId) || null,
    location: S.locations.find((x) => x.id === e.locationId) || null,
  });
});

route('PUT', '/api/estimates/:id', async (req, res, params, body, user) => {
  const e = S.estimates.find((x) => x.id === params.id);
  if (!e) return notFound(res);
  if (['approved', 'declined'].includes(e.status) && !('status' in body)) return bad(res, 'Estimate is closed');
  for (const k of ['name', 'notes']) if (k in body) e[k] = String(body[k]);
  if ('validUntil' in body) e.validUntil = body.validUntil || null;
  if ('items' in body) {
    e.items = cleanItems(body.items);
    Object.assign(e, computeTotals(e.items, S.settings.taxRatePct));
  }
  if ('status' in body) {
    if (!EST_STATUSES.includes(body.status)) return bad(res, 'Invalid status');
    e.status = body.status;
    e.statusAt = new Date().toISOString();
    if (body.status === 'approved') e.soldBy = user.id;
    store.logActivity(user.id, 'status → ' + body.status, 'estimate', e.id, `#${e.number}`);
  }
  store.markDirty('estimates');
  ok(res, expandEstimate(e));
});

// Convert an approved estimate into an invoice (and optionally a follow-up job).
route('POST', '/api/estimates/:id/convert', async (req, res, params, body, user) => {
  const e = S.estimates.find((x) => x.id === params.id);
  if (!e) return notFound(res);
  if (e.status !== 'approved') return bad(res, 'Only approved estimates can be converted');
  let job = e.jobId ? S.jobs.find((j) => j.id === e.jobId) : null;
  if (body.createJob) {
    job = {
      id: store.id(), number: store.nextNumber('job'),
      customerId: e.customerId, locationId: e.locationId,
      tradeId: body.tradeId || null, jobTypeId: body.jobTypeId || null,
      summary: String(body.summary || 'Sold: ' + e.name), priority: 'normal', status: 'scheduled',
      start: body.start || null, end: body.end || null,
      techIds: Array.isArray(body.techIds) ? body.techIds : [], tags: [], leadSource: '',
      notes: [{ id: store.id(), at: new Date().toISOString(), userId: user.id, text: `Created from estimate #${e.number}` }],
      createdAt: new Date().toISOString(), createdBy: user.id,
    };
    S.jobs.unshift(job);
    store.markDirty('jobs');
    store.logActivity(user.id, 'created', 'job', job.id, `#${job.number} from estimate #${e.number}`);
  }
  const inv = {
    id: store.id(), number: store.nextNumber('invoice'),
    customerId: e.customerId, locationId: e.locationId, jobId: job ? job.id : null, estimateId: e.id,
    items: e.items, subtotal: e.subtotal, tax: e.tax, total: e.total,
    status: 'draft', payments: [], balance: e.total,
    createdAt: new Date().toISOString(), createdBy: user.id,
  };
  S.invoices.unshift(inv);
  store.markDirty('invoices');
  store.logActivity(user.id, 'created', 'invoice', inv.id, `#${inv.number} from estimate #${e.number}`);
  ok(res, { invoice: expandInvoice(inv), job: job ? expandJob(job) : null });
});

// --- invoices
route('GET', '/api/invoices', async (req, res, p, b, u, url) => {
  let list = S.invoices;
  const st = url.searchParams.get('status');
  if (st) list = list.filter((i) => i.status === st);
  ok(res, list.slice(0, 500).map(expandInvoice));
});

function expandInvoice(i) {
  const c = S.customers.find((x) => x.id === i.customerId);
  const j = S.jobs.find((x) => x.id === i.jobId);
  return { ...i, customerName: c ? c.name : '(deleted)', jobNumber: j ? j.number : null };
}

route('POST', '/api/invoices', async (req, res, p, body, user) => {
  const c = S.customers.find((x) => x.id === body.customerId);
  if (!c) return bad(res, 'A valid customer is required');
  const items = cleanItems(body.items);
  const totals = computeTotals(items, S.settings.taxRatePct);
  const inv = {
    id: store.id(), number: store.nextNumber('invoice'),
    customerId: c.id, locationId: body.locationId || null, jobId: body.jobId || null, estimateId: null,
    items, ...totals, status: 'draft', payments: [], balance: totals.total,
    createdAt: new Date().toISOString(), createdBy: user.id,
  };
  S.invoices.unshift(inv);
  store.markDirty('invoices');
  store.logActivity(user.id, 'created', 'invoice', inv.id, `#${inv.number}`);
  ok(res, expandInvoice(inv));
});

route('PUT', '/api/invoices/:id', async (req, res, params, body, user) => {
  const inv = S.invoices.find((x) => x.id === params.id);
  if (!inv) return notFound(res);
  if (inv.status === 'paid' || inv.status === 'void') return bad(res, 'Invoice is closed');
  if ('items' in body) {
    inv.items = cleanItems(body.items);
    Object.assign(inv, computeTotals(inv.items, S.settings.taxRatePct));
    inv.balance = Math.round((inv.total - inv.payments.reduce((s, x) => s + x.amount, 0)) * 100) / 100;
  }
  if ('status' in body) {
    if (!INV_STATUSES.includes(body.status)) return bad(res, 'Invalid status');
    inv.status = body.status;
    store.logActivity(user.id, 'status → ' + body.status, 'invoice', inv.id, `#${inv.number}`);
  }
  store.markDirty('invoices');
  ok(res, expandInvoice(inv));
});

route('POST', '/api/invoices/:id/payments', async (req, res, params, body, user) => {
  const inv = S.invoices.find((x) => x.id === params.id);
  if (!inv) return notFound(res);
  if (inv.status === 'void') return bad(res, 'Invoice is void');
  const amount = Math.round(Number(body.amount) * 100) / 100;
  if (!amount || amount <= 0) return bad(res, 'Payment amount must be positive');
  inv.payments.push({
    id: store.id(), amount, method: String(body.method || 'other'),
    reference: String(body.reference || ''), at: new Date().toISOString(), userId: user.id,
  });
  inv.balance = Math.round((inv.total - inv.payments.reduce((s, x) => s + x.amount, 0)) * 100) / 100;
  if (inv.balance <= 0) inv.status = 'paid';
  store.markDirty('invoices');
  store.logActivity(user.id, 'payment $' + amount.toFixed(2), 'invoice', inv.id, `#${inv.number}`);
  ok(res, expandInvoice(inv));
});

// --- pricebook (admin manages, everyone reads via bootstrap)
route('POST', '/api/pricebook', async (req, res, p, body, user) => {
  if (user.role === 'technician') return forbidden(res);
  if (!body.name) return bad(res, 'Item name is required');
  const it = {
    id: store.id(), code: String(body.code || ''), name: String(body.name),
    description: String(body.description || ''), category: String(body.category || 'General'),
    type: body.type === 'material' ? 'material' : 'service',
    price: Number(body.price) || 0, memberPrice: Number(body.memberPrice) || Number(body.price) || 0,
    cost: Number(body.cost) || 0, taxable: !!body.taxable, tradeId: body.tradeId || null, active: true,
  };
  S.pricebook.push(it);
  store.markDirty('pricebook');
  store.logActivity(user.id, 'created', 'pricebook', it.id, it.name);
  ok(res, it);
});

route('PUT', '/api/pricebook/:id', async (req, res, params, body, user) => {
  if (user.role === 'technician') return forbidden(res);
  const it = S.pricebook.find((x) => x.id === params.id);
  if (!it) return notFound(res);
  for (const k of ['code', 'name', 'description', 'category']) if (k in body) it[k] = String(body[k]);
  if ('type' in body) it.type = body.type === 'material' ? 'material' : 'service';
  for (const k of ['price', 'memberPrice', 'cost']) if (k in body) it[k] = Number(body[k]) || 0;
  if ('taxable' in body) it.taxable = !!body.taxable;
  if ('tradeId' in body) it.tradeId = body.tradeId || null;
  if ('active' in body) it.active = !!body.active;
  store.markDirty('pricebook');
  ok(res, it);
});

// --- dashboard & activity
route('GET', '/api/dashboard', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const jobsToday = S.jobs.filter((j) => j.start && j.start.slice(0, 10) === today && j.status !== 'canceled');
  const openEstimates = S.estimates.filter((e) => ['draft', 'sent'].includes(e.status));
  const soldThisMonth = S.estimates.filter((e) => e.status === 'approved' && (e.statusAt || '').slice(0, 7) === today.slice(0, 7));
  const unpaid = S.invoices.filter((i) => ['draft', 'sent'].includes(i.status));
  ok(res, {
    jobsToday: jobsToday.map(expandJob),
    counts: {
      jobsToday: jobsToday.length,
      unassignedToday: jobsToday.filter((j) => !(j.techIds || []).length).length,
      openEstimates: openEstimates.length,
      openEstimateValue: Math.round(openEstimates.reduce((s, e) => s + e.total, 0) * 100) / 100,
      soldThisMonth: Math.round(soldThisMonth.reduce((s, e) => s + e.total, 0) * 100) / 100,
      arBalance: Math.round(unpaid.reduce((s, i) => s + i.balance, 0) * 100) / 100,
      customers: S.customers.length,
    },
    activity: S.activity.slice(0, 25),
  });
});

route('GET', '/api/activity', async (req, res) => ok(res, S.activity.slice(0, 200)));

// ---------------------------------------------------------------- static + dispatch

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) return notFound(res);
  fs.readFile(full, (err, data) => {
    if (err) {
      // SPA fallback for client-side routes
      if (!path.extname(file)) return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, d2) => e2 ? notFound(res) : send200(res, d2, '.html'));
      return notFound(res);
    }
    send200(res, data, path.extname(full));
  });
}

function send200(res, data, ext) {
  res.writeHead(200, { 'Content-Type': (MIME[ext] || 'application/octet-stream') + '; charset=utf-8' });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.rx.exec(pathname);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    try {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      let user = null;
      if (!r.opts.public) {
        user = getSessionUser(req);
        if (!user) return send(res, 401, { error: 'Not signed in' });
      }
      return await r.handler(req, res, params, body, user, url);
    } catch (err) {
      return send(res, 500, { error: err.message || 'Server error' });
    }
  }
  notFound(res);
});

server.listen(PORT, () => {
  console.log(`Service Colossus running at http://localhost:${PORT}`);
  console.log(`Data directory: ${store.DATA_DIR}`);
  console.log('Default login: admin@opentrades.local / colossus');
});

process.on('SIGINT', () => { store.flushSync(); process.exit(0); });
process.on('SIGTERM', () => { store.flushSync(); process.exit(0); });
process.on('exit', () => store.flushSync());
