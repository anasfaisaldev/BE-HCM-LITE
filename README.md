# HCM Lite: Saylani Hackathon 2026

Two separate apps: `backend/` (Node + Express + MongoDB) and `frontend/` (React + Vite).
Built in phases. **This is Phase 5: every module in the brief is now implemented**, including the two optional ones (CSV import, camera attendance).

## Status

| Module | Status |
|---|---|
| M1 Auth: first-run setup, env bootstrap, login/logout, password change, forced temp-password change, role menus | Done |
| RBAC: server-side role + record-level scope (employee = own record only; HR cannot touch Admin accounts or create HR/Admin) | Done |
| M2 Organization: company rules (start time, grace, weekend, geo), departments, designations | Done |
| M2 Leave types + quotas (defaults 14/8/10/unlimited), public holidays | Done (Admin edits; edits affect new requests only) |
| M3 Employees: register + temp login, search/filters/pagination, 360 profile, salary history, CSV export, self-edit phone/address | Done |
| M3 CSV import with dry-run (row, field, reason for every error; all-or-nothing import) | Done |
| M9 Audit log (immutable, Admin-only viewer) | Done for setup/org/employee actions |
| M4 Attendance: server-timed check-in/out (409 duplicate), late/half-day/missing_checkout/absent rules, calendar, daily board, corrections with HR decision | Done |
| M5 Leave: apply/cancel/balance/history, working days only, overlap + quota 422, HR approve/reject with comment, employee notification | Done |
| M9 In-app notifications (leave, correction, payslip) | Done |
| Smart leave (plain-language prefill, employee confirms) | Done |
| M6 Payroll: monthly draft (HR/Admin), Admin-only finalize, locked after finalize, prorated joiners/leavers, tax slabs, PDF payslips, employee sees own finalized payslips only, payslip notifications | Done |
| M7 Dashboards: Admin, HR, Employee; server-side aggregation; date-range + department filters; empty-data safe | Done |
| M8 AI: `/ai/chat` with 7 role-scoped tools, policy Q&A, dashboard summaries, smart leave prefill, 15 s timeout, retry-once JSON, fallback, 20/hour limit, `ai_logs` | Done (needs `AI_API_KEY`) |
| M9 Announcements (HR/Admin post, shown on dashboards) | Done |
| Camera attendance: exactly one face, GPS accuracy <= 100 m, server-side Haversine radius check, result stored (no photo) | Done (see limitation below) |

Tests: `unit`, `rules`, `payroll`, `phase4` (metrics, AI tool permissions), `aijson`, `csvgeo` (CSV parser, Haversine), and `api` (end-to-end) (salary, hashing, RBAC middleware, late/half-day boundaries, working days, overlap, quota, absent logic, timezone).
`tests/api.test.js` is an end-to-end flow on an in-memory MongoDB (first run downloads a mongod binary): setup, registration, forced password change, RBAC and data isolation, duplicate check-in 409, leave overlap/quota 422, approval + notification.
`rules`, `payroll`, `phase4` and `csvgeo` tests need no dependencies and pass (20 tests). The rest, including `api.test.js` (which now covers dashboards, announcements and the AI flow against a fake LLM server), have not been run: run `npm install && npm test` in `backend/` and send me any failures.

## Run locally

Requires Node 18+ and MongoDB running locally (or an Atlas URI).

```bash
# backend
cd backend && cp .env.example .env     # set MONGODB_URI and a long random JWT_SECRET
npm install && npm run dev             # http://localhost:5000
npm test

# frontend (new terminal)
cd frontend && npm install && npm run dev   # http://localhost:5173
```

The database starts empty. Open the frontend: you get the setup screen, which creates the company and first Admin.
Alternative: set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `backend/.env`; the Admin is created on first start with a forced password change.

## Phase 1 demo flow

1. Setup company + Admin. 2. Organization: add a department and designation. 3. Employees: register an employee, copy the temp password.
4. Sign out, sign in as the employee: forced password change, then My profile (phone/address). Employee cannot open /employees (403 from API, redirect in UI).
5. Back as Admin: Audit log shows every step.

## Attendance and leave rules (as implemented)

- Business dates are `YYYY-MM-DD` in the company timezone (default Asia/Karachi). All times come from the server clock.
- **Late:** check-in strictly after office start + grace (09:15:01 or later). **Half-day:** fewer than 5 worked hours, checked at check-out; it overrides late (exactly 5h is a full day).
- **Missing checkout:** a past day with a check-in and no check-out is set to `missing_checkout` (swept on read).
- **Absent:** computed, not stored: past working day, no record, no approved leave. Today shows `not_checked_in` until the day ends. Weekends/holidays are never absent. A day with a record shows the record status.
- **Corrections:** employee proposes check-in/out times and a reason; HR/Admin approve (recomputes status) or reject with comment; nobody can decide their own request.
- **Leave:** working days only (weekend setting and holidays excluded); one request must stay inside one calendar year; balance counts approved + pending days per year; unpaid is unlimited. Employees can cancel pending requests, or approved ones that have not started.

## Payroll rules (as implemented)

For month M, **W** = working days in the month (weekends and public holidays excluded). Employee gross G = basic + 40% HRA + 10% medical (= 1.5 x basic; allowances are components of gross, never added on top).

- **Daily rate** = G / W.
- **Service window**: from max(1st of month, joining date) to min(last of month, leaving date). **E** = working days in that window. Proration factor = E / W. Prorated gross = G x E / W.
- **Absence deduction** = absent days x daily rate. Absent = working day in the window, in the past, no attendance record, no approved leave.
- **Unpaid-leave deduction** = approved unpaid-leave working days x daily rate.
- **Half-day deduction** = 0.5 x daily rate per half_day. `missing_checkout` counts as present.
- **No double deductions**: a day with an attendance record is never absent or unpaid leave; leave days are never absent; paid leave costs nothing; unpaid leave is deducted once.
- **Tax**: annualised = G x 12, marginal slabs: up to 600,000 = 0; 600,001-1,200,000 = 5% of the excess over 600,000; 1,200,001-2,400,000 = 30,000 + 15% of excess over 1,200,000; 2,400,001-3,600,000 = 210,000 + 25% over 2,400,000; above 3,600,000 = 510,000 + 35% over 3,600,000. Upper bounds are inclusive (600,000 -> 0; 1,200,000 -> 30,000; 2,400,000 -> 210,000; 3,600,000 -> 510,000). Monthly tax = annual tax / 12 x E / W. Tax is based on contractual gross, so attendance deductions neither reduce nor add to it (no tax-on-deduction double counting). These are illustrative hackathon slabs.
- **Net** = prorated gross - absence - unpaid leave - half-day - tax, never below 0.
- Salary used = the latest structure effective on or before month end (a mid-month raise applies to the whole month).
- **Lifecycle**: HR or Admin generates/regenerates a **draft** (month must have started). Only **Admin** finalizes, and only after the month has ended. Finalize is atomic (second attempt = 409), locks the run and all payslips (model-level guards reject updates/deletes), and notifies employees. Finalized months can never be regenerated (409). Payslips snapshot names and amounts, so later edits never change them.
- Employees see only their own **finalized** payslips; other people's payslips return 404. HR does not see Admin-account payslips in run listings, although run totals include every employee.

## CSV import

Employees page, Import CSV (HR/Admin). Template button included. Columns: `employeeCode, name, email, phone, gender, department, designation, joiningDate, status, basicSalary` (required: employeeCode, name, email, department, designation, joiningDate, basicSalary; optional: phone, gender, status). Department and designation are matched by name (case-insensitive) and must already exist. Max 200 rows. Imported accounts always get the Employee role.

- **Dry run** (`POST /employees/import {csv, dryRun:true}`, the default) validates everything and writes nothing. Every problem is returned as `{row, field, reason}`: missing required values, unknown department/designation, bad email, non-ISO or impossible dates, salary not a number or <= 0, employee code or email already in the system, duplicates inside the file, wrong column count, missing header columns. Row numbers are CSV record numbers (header = row 1).
- **Real import** (`dryRun:false`) refuses the whole file (422 with the same error list) if any row is invalid, so nothing is half-imported. On success it returns each person's one-time temporary password (the UI offers a download).

## Camera attendance

Admin enables **Require camera + GPS** under Organization (needs office latitude/longitude and radius). When it is off, employees may still choose "Use camera". The browser sends only `{faceCount, lat, lng, accuracy}`; the server rejects with 422 unless exactly one face was seen, accuracy is 100 m or better, and the **server-computed Haversine distance** is within the office radius. Distance and timestamps from the client are ignored. The result (method, face count, distance, accuracy) is stored on the attendance record; no photo is captured or stored.

**Limitation (be upfront in the demo):** face detection runs in the browser using the `FaceDetector` API (Chrome/Edge); other browsers show a message and cannot do camera check-in. Because the face count and GPS come from the client, a determined user could spoof them; this is a convenience control, not tamper-proof biometric security. To harden it, swap in server-side face detection and send a frame for verification.

## Dashboard metric definitions

All computed on the server from the database (`dashboardService.js`). Filters: `from`, `to` (default: 1st of the month to today; max 93 days) and `department`. Employees ignore filters and see only their own data; HR never includes Admin accounts. Anything with a 0 denominator returns `null` and the UI shows "-".

- **Headcount** = employees in service on `to` (joined on/before it; last working day, if any, on/after it).
- **Attrition (YTD)** = leavers from 1 Jan of `to`'s year through `to` / average of (headcount on 31 Dec of the prior year, headcount on `to`) x 100.
- **Payroll cost** = gross of **finalized** payslips for months overlapping the range (drafts are excluded); by department uses the payslip snapshot.
- **Average salary** = mean current gross of in-service employees, overall, by department and by designation.
- **Attendance rate** = (present + late + missing_checkout + 0.5 x half_day) / (working-day records - on_leave), where records = present + late + half_day + missing_checkout + absent.
- **Late %** = late / (present + late). **Absenteeism** = absent / expected working days (all in-service working days up to today, leave days included). **Leave utilization** = approved leave days (requests starting in range) / (annual quota x headcount); unpaid has no quota so no %.
- Attendance statuses use the same `classifyDay` rule as the calendar, daily board and payroll, so the dashboard, the daily board and payslip absence counts reconcile (an automated test checks absent days = sum of payslip absent days). Today's not-yet-checked-in and future days are excluded.
- Gender/tenure/headcount/salary/payroll/leave breakdowns use MongoDB aggregation. Attendance uses one bounded scan because "absent" is derived (no record) rather than stored.

## AI setup

1. Get an API key from a hosted LLM provider with tool calling. The default client targets the Anthropic Messages API.
2. In `backend/.env`: `AI_API_KEY=...` (server only, never sent to the browser), optionally `AI_MODEL` and `AI_API_URL`. Restart the backend.
3. To use another provider, replace the single `callLLM` function in `src/ai/llmClient.js`.

How it is kept safe: the model is only *offered* tools its role may use (`ai/toolPolicy.js`: employees get own-record tools only) and every call is re-checked; tools call the same services as the REST dashboards with the signed-in user as actor, so the model never queries the database. The system prompt carries the company policy generated from live settings and tells the model to admit uncertainty. Dashboard summaries recompute the KPI JSON on the server (the client sends only filters), require 3-5 bullets as validated JSON with one retry, and fall back to plain generated sentences if AI is down. Smart leave only returns a pre-filled form; the employee must press Submit, which runs the normal validation. Every call is stored in `ailogs` (prompt, tool calls, response, status, latency). Limit: 20 AI requests per user per hour (HTTP 429). Without a key, or on timeout (15 s), users get a friendly message and the rest of the app works. All AI output is labelled.

## Five-minute demo script

1. **(0:30)** Fresh database: setup screen creates the company and Admin. Point out there is no fake data; dashboard shows an honest empty state.
2. **(1:00)** Organization: add a department and designation, check leave quotas (14/8/10), add a holiday. Register two employees (one HR). Show the one-time temp password and the forced password change on first login.
3. **(1:00)** As an employee: check in (server time), try again (409 conflict), request an attendance correction. Ask "next Monday and Tuesday off for a wedding" in Smart leave, review the pre-filled form, submit.
4. **(1:00)** As HR: approve the leave with a comment (employee gets a notification), review the correction, open the daily board. Create a payroll draft and show a payslip's numbers. Show HR cannot finalize.
5. **(0:45)** As Admin: finalize payroll (locked), download the PDF payslip, open the dashboard: headcount, payroll cost and averages match the payroll screen; click "Generate" for the AI summary.
6. **(0:45)** AI: as the employee ask for their leave balance, then "what is Omar's salary?" (refused). In Roman Urdu: "meri leave balance kya hai?". Show the audit log recording every step.

## Design decisions

- **Salary:** `basic` is stored; HRA = 40% basic, medical = 10% basic, **gross = basic + HRA + medical = 1.5 × basic**.
  The "1.5×" rule and the allowance rules describe the same total, so allowances are never added on top of gross.
- **Auth:** JWT in an httpOnly, SameSite=Lax cookie (Secure in production). The user is reloaded from the DB per request, so deactivation and role changes apply instantly.
- Users with a temporary password are blocked (403 `PASSWORD_CHANGE_REQUIRED`) from every endpoint except `/auth/me`, `/auth/logout`, `/auth/change-password`.
- Resigned/terminated employees are deactivated and cannot sign in.
- Passwords use `bcryptjs` (pure JS bcrypt, same hash format as `bcrypt`, no native build step).
- Dev: Vite proxies `/api` to the backend, so cookies are same-origin.

## API (all under `/api`, JSON `{success, data, meta?}` or `{success:false, error:{code,message,details?}}`)

| Method & path | Who | Notes |
|---|---|---|
| GET `/setup/status`, POST `/setup` | public | 409 once setup is done |
| POST `/auth/login`, `/auth/logout`, `/auth/change-password`; GET `/auth/me` | login public, rest signed in | login rate-limited |
| GET `/org` | any signed-in | company, departments, designations |
| PUT `/org/settings`, POST `/org/departments`, `/org/designations` | Admin | |
| GET `/employees` (search, department, designation, status, page, limit) | Admin, HR | |
| POST `/employees` | Admin, HR | returns one-time `tempPassword`; only Admin may set role hr/admin; 409 duplicates, 422 validation |
| GET `/employees/export.csv` | Admin, HR | formula-injection safe |
| GET/PATCH `/employees/me` | any | PATCH: phone, address only |
| GET `/employees/:id` | Admin, HR; Employee only for own id (else 403) | |
| PATCH `/employees/:id` | Admin, HR | salary change appends a new SalaryStructure |
| GET `/audit` | Admin | paginated, newest first |

Phase 2 endpoints (signed in; HR/Admin where noted):
`GET /attendance/today`, `POST /attendance/check-in` (409 duplicate), `POST /attendance/check-out`, `GET /attendance/calendar?month=YYYY-MM[&employeeId]`,
`GET /attendance/board?date&department` (HR/Admin), `POST|GET /attendance/corrections`, `PATCH /attendance/corrections/:id` (HR/Admin),
`GET /leave/balance`, `GET|POST /leave/requests`, `POST /leave/requests/:id/cancel`, `PATCH /leave/requests/:id/decision` (HR/Admin),
`GET /notifications`, `POST /notifications/read-all`, `PATCH /notifications/:id/read`,
`POST /org/holidays`, `DELETE /org/holidays/:id`, `POST|PATCH /org/leave-types` (Admin).

Phase 3 endpoints: `GET|POST /payroll/runs` (HR/Admin; POST = create or refresh draft for `{month}`), `GET /payroll/runs/:id?search&page` (HR/Admin),
`POST /payroll/runs/:id/finalize` (**Admin only**), `GET /payslips` (own, finalized), `GET /payslips/:id`, `GET /payslips/:id/pdf`.

Phase 4 endpoints: `GET /dashboard?from&to&department` (role-aware), `GET|POST /announcements`, `DELETE /announcements/:id` (HR/Admin),
`POST /ai/chat {message, history}`, `POST /ai/dashboard-summary {from,to,department}` (HR/Admin), `POST /ai/leave-parse {text}`.

Phase 5 endpoints: `POST /employees/import {csv, dryRun}` (HR/Admin); `POST /attendance/check-in|check-out` accept optional `{verification:{faceCount,lat,lng,accuracy}}`; `PUT /org/settings` accepts `requireCameraCheckIn`.

Status codes used: 401, 403, 404, 409, 422, 429, 500.

## Deployment

**Simplest (one origin, one service):** the API can serve the built React app, so the login cookie needs no CORS or proxy setup.

```bash
# Docker: builds the frontend, runs API + MongoDB, opens on http://localhost:5000
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build
```

Without Docker: `cd frontend && npm run build`, then in `backend/.env` set `SERVE_FRONTEND=../frontend/dist`, `NODE_ENV=production`, a strong `JWT_SECRET`, `MONGODB_URI` (e.g. MongoDB Atlas) and run `npm start`. On Render/Railway/Fly deploy the root `Dockerfile` and set `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN` (the public URL) and optionally `AI_API_KEY`.

**HTTPS is required in production** for the Secure cookie, and browsers only allow camera and GPS on HTTPS (or localhost). If you host the frontend separately (Vercel/Netlify), proxy `/api` to the backend on the same domain, because the auth cookie is SameSite=Lax. `trust proxy` is already enabled for hosts behind a load balancer.

CI (`.github/workflows/ci.yml`) runs the backend tests and a frontend build on every push. Never commit `.env`; `AI_API_KEY` stays on the backend.

## First-run checklist (do this before the demo)

1. `cd backend && npm install && npm test` and note any failures (the end-to-end file downloads an in-memory MongoDB the first time, so it needs internet once).
2. `cd frontend && npm install && npm run build` to confirm the UI compiles.
3. Start both, open the setup screen on an empty database and walk the demo script above once, including the AI questions with a real `AI_API_KEY`.
4. Test the camera flow on the real device and browser you will demo on (Chrome/Edge, over HTTPS or localhost).
