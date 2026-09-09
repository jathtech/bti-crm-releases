import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4599;
const BASE = `http://localhost:${PORT}`;
let proc;
let cookie = '';

async function api(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { ...(body && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

before(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), COLOSSUS_DATA_DIR: mkdtempSync(path.join(tmpdir(), 'colossus-')) },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});

after(() => proc.kill());

test('rejects unauthenticated and bad login, accepts seeded admin', async () => {
  assert.equal((await api('GET', '/api/bootstrap')).status, 401);
  assert.equal((await api('POST', '/api/login', { email: 'admin@opentrades.local', password: 'wrong' })).status, 401);
  const r = await api('POST', '/api/login', { email: 'admin@opentrades.local', password: 'colossus' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'admin');
  assert.ok(!r.data.user.password, 'password hash must not leak');
});

test('bootstrap has seeded trade-agnostic settings and pricebook', async () => {
  const r = await api('GET', '/api/bootstrap');
  assert.equal(r.status, 200);
  assert.ok(r.data.settings.trades.length >= 1);
  assert.ok(r.data.settings.jobTypes.length >= 1);
  assert.ok(r.data.pricebook.length >= 5);
});

let customerId, locationId, jobId, estimateId, invoiceId;

test('customer + location creation', async () => {
  const r = await api('POST', '/api/customers', {
    name: 'Jane Homeowner', phone: '555-0100', email: 'jane@example.com',
    address: '123 Main St', city: 'Austin', state: 'TX', zip: '78701', leadSource: 'Website',
  });
  assert.equal(r.status, 200);
  customerId = r.data.id;
  locationId = r.data.locations[0].id;
  assert.ok(r.data.number >= 101);
  const detail = await api('GET', '/api/customers/' + customerId);
  assert.equal(detail.data.locations.length, 1);
  assert.equal((await api('POST', '/api/customers', {})).status, 400);
});

test('job lifecycle: create, schedule, assign, status, notes', async () => {
  const boot = (await api('GET', '/api/bootstrap')).data;
  const tech = boot.users.find((u) => u.role === 'technician');
  const r = await api('POST', '/api/jobs', {
    customerId, locationId, tradeId: boot.settings.trades[0].id, jobTypeId: boot.settings.jobTypes[0].id,
    summary: 'No cooling', priority: 'high',
    start: new Date().toISOString(), techIds: [tech.id], notes: 'Booked via test',
  });
  assert.equal(r.status, 200);
  jobId = r.data.id;
  assert.equal(r.data.status, 'scheduled');
  assert.equal(r.data.customerName, 'Jane Homeowner');

  const upd = await api('PUT', '/api/jobs/' + jobId, { status: 'dispatched', addNote: 'Tech en route' });
  assert.equal(upd.data.status, 'dispatched');
  assert.equal((await api('PUT', '/api/jobs/' + jobId, { status: 'bogus' })).status, 400);

  const today = new Date().toISOString().slice(0, 10);
  const byDay = await api('GET', `/api/jobs?from=${today}&to=${today}`);
  assert.ok(byDay.data.some((j) => j.id === jobId));
});

test('estimate: totals, approval, conversion to invoice + follow-up job', async () => {
  const boot = (await api('GET', '/api/bootstrap')).data;
  const svc = boot.pricebook.find((i) => !i.taxable);
  const mat = boot.pricebook.find((i) => i.taxable);
  const r = await api('POST', '/api/estimates', {
    customerId, locationId, jobId, name: 'Replace blower motor',
    items: [
      { pricebookId: svc.id, code: svc.code, name: svc.name, qty: 1, price: 100, taxable: false },
      { pricebookId: mat.id, code: mat.code, name: mat.name, qty: 2, price: 50, taxable: true },
    ],
  });
  assert.equal(r.status, 200);
  estimateId = r.data.id;
  assert.equal(r.data.subtotal, 200);
  const expectedTax = Math.round(100 * (boot.settings.taxRatePct / 100) * 100) / 100;
  assert.equal(r.data.tax, expectedTax);
  assert.equal(r.data.total, Math.round((200 + expectedTax) * 100) / 100);

  // cannot convert before approval
  assert.equal((await api('POST', `/api/estimates/${estimateId}/convert`, {})).status, 400);
  await api('PUT', '/api/estimates/' + estimateId, { status: 'approved' });
  const conv = await api('POST', `/api/estimates/${estimateId}/convert`, { createJob: true, summary: 'Install motor' });
  assert.equal(conv.status, 200);
  invoiceId = conv.data.invoice.id;
  assert.equal(conv.data.invoice.total, r.data.total);
  assert.ok(conv.data.job, 'follow-up job created');
  assert.equal(conv.data.job.summary, 'Install motor');
});

test('invoice payments drive balance and paid status', async () => {
  const p1 = await api('POST', `/api/invoices/${invoiceId}/payments`, { amount: 100, method: 'card' });
  assert.equal(p1.status, 200);
  assert.ok(p1.data.balance > 0);
  assert.notEqual(p1.data.status, 'paid');
  const p2 = await api('POST', `/api/invoices/${invoiceId}/payments`, { amount: p1.data.balance, method: 'check', reference: '1042' });
  assert.equal(p2.data.balance, 0);
  assert.equal(p2.data.status, 'paid');
  assert.equal((await api('POST', `/api/invoices/${invoiceId}/payments`, { amount: -5 })).status, 400);
});

test('role enforcement: technician cannot touch settings, pricebook, or others\' jobs', async () => {
  const adminCookie = cookie;
  cookie = '';
  await api('POST', '/api/login', { email: 'tech2@opentrades.local', password: 'colossus' });
  assert.equal((await api('PUT', '/api/settings', { companyName: 'Hacked' })).status, 403);
  assert.equal((await api('POST', '/api/pricebook', { name: 'x' })).status, 403);
  // tech2 is not assigned to the job (tech1 is)
  assert.equal((await api('PUT', '/api/jobs/' + jobId, { status: 'completed' })).status, 403);
  cookie = adminCookie;
});

test('do-not-service customers cannot be booked', async () => {
  await api('PUT', '/api/customers/' + customerId, { doNotService: true });
  assert.equal((await api('POST', '/api/jobs', { customerId })).status, 400);
  await api('PUT', '/api/customers/' + customerId, { doNotService: false });
});

test('dashboard aggregates', async () => {
  const r = await api('GET', '/api/dashboard');
  assert.equal(r.status, 200);
  assert.ok(r.data.counts.jobsToday >= 1);
  assert.ok(r.data.counts.customers >= 1);
  assert.ok(Array.isArray(r.data.activity) && r.data.activity.length > 0);
});
