# 🏛️ Service Colossus

Trade-agnostic field service management for **OpenTrades** — a self-hosted, ServiceTitan-style platform covering the core office + field workflow for any trade (HVAC, plumbing, electrical, roofing, garage doors… whatever you configure).

Zero dependencies: one Node.js process, JSON-file storage, no build step. Point the BTI desktop shell (or any browser) at it.

## Quick start

```bash
cd service-colossus
node server.js          # or: npm start
# → http://localhost:4180
```

**Default logins** (seeded on first run — change passwords in Settings):

| Role | Email | Password |
|---|---|---|
| Admin | `admin@opentrades.local` | `colossus` |
| Dispatcher | `dispatch@opentrades.local` | `colossus` |
| Technician | `tech1@opentrades.local` / `tech2@opentrades.local` | `colossus` |

Set `PORT` to change the port and `COLOSSUS_DATA_DIR` to relocate data storage (default: `./data`, gitignored).

## What it does

- **Customers & locations** — residential/commercial accounts, multiple service locations per customer, contacts, tags, lead sources, Do-Not-Service flag, full history (jobs, estimates, invoices) on the customer page.
- **Jobs** — booked against a customer + location with trade (business unit), job type, priority, summary, and booking notes. Status lifecycle: scheduled → dispatched → in-progress → on-hold / completed / canceled. Timestamped notes with author.
- **Dispatch board** — day view with a lane per technician (plus Unassigned), jobs rendered as time-positioned chips colored by trade. Navigate days, click a chip to open the job.
- **Estimates** — built from the pricebook (or custom lines) with qty/price/tax and live totals. Lifecycle: draft → presented → approved (sold) / declined. Approved estimates convert to an invoice with one click, optionally spawning a follow-up job to perform the work.
- **Invoices & payments** — line items, tax, payments (cash/check/card/financing), running balance, auto-marks paid, void.
- **Pricebook** — categorized services & materials with standard/member pricing, cost, taxability, and optional trade restriction. Admin/dispatcher editable.
- **Trade-agnostic settings** — define your own trades (with dispatch-board colors), job types (with default durations), tax rate, business hours, and company name.
- **Users & roles** — `admin` (everything), `dispatcher` (everything except settings/user admin), `technician` (works own jobs, adds notes/estimates; no pricebook/settings edits).
- **Dashboard** — jobs today, unassigned count, open estimate pipeline, sold this month, outstanding A/R, and an activity feed of who did what.

## Architecture

```
service-colossus/
├── server.js        # HTTP server + REST API + auth (cookie sessions, scrypt passwords)
├── lib/store.js     # JSON persistence (data/*.json), seeding, sequences, activity log
├── public/          # SPA: index.html, app.js (vanilla JS, hash routing), styles.css
├── test/api.test.mjs
└── data/            # created at runtime, gitignored
```

The API is plain REST under `/api/*` (login, customers, locations, jobs, estimates, invoices, pricebook, users, settings, dashboard) — easy to integrate with the BTI speed-to-lead pipeline later (e.g. POST a booked lead straight to `/api/customers` + `/api/jobs`).

## Tests

```bash
npm test    # boots the server on a temp data dir and exercises the API end-to-end
```
