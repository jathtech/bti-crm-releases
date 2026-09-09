'use strict';
// Simple JSON-file persistence layer. Each collection is one file under data/.
// Writes are debounced per collection; flushSync() runs on process exit.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.COLOSSUS_DATA_DIR || path.join(__dirname, '..', 'data');

const COLLECTIONS = [
  'settings', 'users', 'customers', 'locations', 'jobs',
  'estimates', 'invoices', 'pricebook', 'sequences', 'sessions', 'activity',
];

const state = {};
const dirty = new Set();
let flushTimer = null;

function fileFor(name) { return path.join(DATA_DIR, name + '.json'); }

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const name of COLLECTIONS) {
    try {
      state[name] = JSON.parse(fs.readFileSync(fileFor(name), 'utf8'));
    } catch {
      state[name] = name === 'settings' || name === 'sequences' ? {} : [];
    }
  }
  seedIfEmpty();
}

function markDirty(name) {
  dirty.add(name);
  if (!flushTimer) flushTimer = setTimeout(flush, 250);
}

function flush() {
  flushTimer = null;
  for (const name of dirty) {
    const tmp = fileFor(name) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state[name], null, 2));
    fs.renameSync(tmp, fileFor(name));
  }
  dirty.clear();
}

function flushSync() { if (flushTimer) clearTimeout(flushTimer); flush(); }

function id() { return crypto.randomBytes(8).toString('hex'); }

// Sequential document numbers per type (job #1001, estimate #2001, ...)
function nextNumber(kind) {
  const starts = { job: 1000, estimate: 2000, invoice: 3000, customer: 100 };
  const cur = state.sequences[kind] || starts[kind] || 0;
  state.sequences[kind] = cur + 1;
  markDirty('sequences');
  return cur + 1;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(check));
}

function seedIfEmpty() {
  if (!state.settings.companyName) {
    state.settings = {
      companyName: 'OpenTrades',
      taxRatePct: 8.25,
      currency: 'USD',
      // Business units — the trades this company operates. Fully editable in Settings.
      trades: [
        { id: id(), name: 'HVAC', color: '#e8590c' },
        { id: id(), name: 'Plumbing', color: '#1971c2' },
        { id: id(), name: 'Electrical', color: '#f08c00' },
      ],
      jobTypes: [
        { id: id(), name: 'Service Call', durationMin: 120 },
        { id: id(), name: 'Estimate / Sales Visit', durationMin: 90 },
        { id: id(), name: 'Installation', durationMin: 480 },
        { id: id(), name: 'Maintenance', durationMin: 90 },
        { id: id(), name: 'Warranty', durationMin: 120 },
      ],
      tagTypes: ['VIP', 'Member', 'Callback', 'Warranty', 'Do Not Service'],
      leadSources: ['Phone Call', 'Website', 'Referral', 'Google', 'Repeat Customer', 'Other'],
      businessHours: { start: 7, end: 19 },
    };
    markDirty('settings');
  }
  if (!state.users.length) {
    state.users = [
      { id: id(), name: 'Admin', email: 'admin@opentrades.local', role: 'admin', password: hashPassword('colossus'), active: true, color: '#495057' },
      { id: id(), name: 'Dana Dispatcher', email: 'dispatch@opentrades.local', role: 'dispatcher', password: hashPassword('colossus'), active: true, color: '#5f3dc4' },
      { id: id(), name: 'Terry Technician', email: 'tech1@opentrades.local', role: 'technician', password: hashPassword('colossus'), active: true, color: '#2b8a3e' },
      { id: id(), name: 'Pat Plumber', email: 'tech2@opentrades.local', role: 'technician', password: hashPassword('colossus'), active: true, color: '#1971c2' },
    ];
    markDirty('users');
  }
  if (!state.pricebook.length) {
    const cats = [
      ['Diagnostic', 'service', [
        ['DIAG-01', 'Diagnostic / Trip Charge', 'Dispatch, on-site diagnostic and written findings', 89, 0],
        ['DIAG-02', 'After-Hours Diagnostic', 'Evenings, weekends and holidays', 149, 0],
      ]],
      ['Repairs', 'service', [
        ['REP-01', 'Minor Repair (up to 1 hr)', 'Labor and standard consumables', 189, 45],
        ['REP-02', 'Standard Repair (1–2 hrs)', 'Labor and standard consumables', 349, 80],
        ['REP-03', 'Major Repair (2–4 hrs)', 'Labor and standard consumables', 649, 150],
      ]],
      ['Installations', 'service', [
        ['INST-01', 'Standard Equipment Install', 'Remove and replace, haul-away included', 1850, 600],
        ['INST-02', 'Premium Equipment Install', 'Full replacement with upgraded components', 3400, 1200],
      ]],
      ['Maintenance', 'service', [
        ['MAINT-01', 'Annual Tune-Up', 'Multi-point inspection and tune-up', 129, 25],
        ['MAINT-02', 'Membership Visit', 'Included with active membership', 0, 25],
      ]],
      ['Materials', 'material', [
        ['MAT-01', 'Standard Part — Tier 1', 'Common replacement part', 45, 18],
        ['MAT-02', 'Standard Part — Tier 2', 'Mid-grade replacement part', 120, 55],
        ['MAT-03', 'Standard Part — Tier 3', 'Premium replacement part', 320, 160],
      ]],
      ['Memberships', 'service', [
        ['MEM-01', 'Annual Service Membership', 'Priority scheduling, waived trip fees, seasonal tune-ups', 199, 0],
      ]],
    ];
    for (const [category, type, items] of cats) {
      for (const [code, name, description, price, cost] of items) {
        state.pricebook.push({
          id: id(), code, name, description, category, type,
          price, memberPrice: Math.round(price * 0.9 * 100) / 100, cost,
          taxable: type === 'material', tradeId: null, active: true,
        });
      }
    }
    markDirty('pricebook');
  }
}

function logActivity(userId, action, entity, entityId, detail) {
  state.activity.unshift({ id: id(), at: new Date().toISOString(), userId, action, entity, entityId, detail: detail || '' });
  if (state.activity.length > 2000) state.activity.length = 2000;
  markDirty('activity');
}

module.exports = { load, state, markDirty, flushSync, id, nextNumber, hashPassword, verifyPassword, logActivity, DATA_DIR };
