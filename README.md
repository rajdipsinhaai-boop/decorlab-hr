# Decorlab HR Performance Dashboard

A private web app that shows how each Decorlab employee performed in a month: a score, a red / yellow / green rating, attendance, and a downloadable report card.

This document explains **how the system works today** — what talks to what, where the data lives, and what to watch out for. It is written for both technical and non-technical readers. If you only want the big picture, read sections 1–3. Section 12 lists known weak spots honestly.

> **Status note.** This README describes the system as it currently exists. A redesign (a proper database plus a job queue, replacing the Google Sheet as the source of truth) is being planned; it is not built yet. See [Where this is heading](#13-where-this-is-heading).

---

## Contents

1. [What the app does](#1-what-the-app-does)
2. [The big picture](#2-the-big-picture)
3. [Who can see what](#3-who-can-see-what)
4. [Tech stack](#4-tech-stack)
5. [Repository map](#5-repository-map)
6. [How the main flows work](#6-how-the-main-flows-work)
7. [How scores are calculated](#7-how-scores-are-calculated)
8. [The Google Sheet](#8-the-google-sheet)
9. [The Supabase database](#9-the-supabase-database)
10. [Configuration (environment variables)](#10-configuration-environment-variables)
11. [Running, building and deploying](#11-running-building-and-deploying)
12. [Known limitations and gotchas](#12-known-limitations-and-gotchas)
13. [Where this is heading](#13-where-this-is-heading)
14. [Glossary](#14-glossary)

---

## 1. What the app does

In plain words:

- **Leadership** signs in and sees every employee's monthly score, ranking, attendance, trends and details.
- **Employees** sign in and see only their own result and their own report card.
- **Leadership can upload files** (monthly attendance, WhatsApp chat exports) and **request report cards** for a month.
- **A background job** picks up those requests, reads the uploaded files, updates the spreadsheet, and creates a PDF report card for every employee.
- **Directors can enter a rating** per employee per month, which is stored in the database.
- **An optional AI assistant** answers questions about the team, using the current numbers. It can only read; it cannot change anything.

The important idea to hold on to: **the Google Sheet is the source of truth.** Most numbers you see in the dashboard were calculated inside the spreadsheet, and the app mainly reads and displays them.

---

## 2. The big picture

```
                    ┌──────────────────────────────────────────┐
                    │  EXTERNAL AUTOMATIONS (outside this repo) │
                    │  e.g. a scheduled Claude task that pulls  │
                    │  DPR / task data and drops files in Drive │
                    └──────────────┬───────────────────────────┘
                                   │ files in a Drive staging folder
                                   ▼
┌───────────────┐  sign in   ┌───────────────┐           ┌──────────────────────┐
│    Browser    │──────────► │   Supabase    │           │    Google Drive      │
│ (React app)   │            │ Auth + tables │           │ uploads, report PDFs │
└──────┬────────┘            └───────▲───────┘           └──────────▲───────────┘
       │ calls                       │ roles, ratings               │
       ▼                             │                              │
┌──────────────────────────────────────────┐                        │
│  THE APP SERVER  (TanStack Start on Vercel)                       │
│                                                                   │
│  • dashboard data      • uploads          • report-card download  │
│  • director ratings    • AI assistant     • access management     │
└──────┬────────────────────────────────────────────────────────────┘
       │ reads + appends rows (service account)
       ▼
┌────────────────────────────────────────────────────────────────┐
│                     GOOGLE SHEET  (source of truth)             │
│  Employee Master · Supervisor KRA · Designer KRA · EA KRA       │
│  Monthly Summary · Daily Attendance · Raw Data                  │
│  Control  ◄── the job queue (one row = one request)             │
└──────▲─────────────────────────────────────────────────────────┘
       │ picks up PENDING rows, one per run
┌──────┴─────────────────────────────────────────────────────────┐
│  QUEUE PROCESSOR   GET/POST /api/public/cron/process-queue      │
│  called on a schedule by something outside this repo            │
│  reads files from Drive → writes the Sheet → builds PDFs        │
└─────────────────────────────────────────────────────────────────┘
```

Three separate systems are involved, and each has a distinct job:

| System | Job |
|---|---|
| **Google Sheet + Drive** | Holds the HR data, the uploaded files and the generated report cards. Also acts as the job queue. |
| **Supabase** | Handles sign-in, decides who is allowed in and with what role, and stores director ratings. |
| **The app (Vercel)** | Shows the dashboard, receives uploads, and runs the queue processor. |

---

## 3. Who can see what

There are three roles.

| Role | Sees | Can do |
|---|---|---|
| **admin** (leadership) | Everything: all employees, scores, ranks, attendance | Upload files, create reports, manage who has access, enter director ratings, use the AI assistant |
| **manager** | A roster of employees and their own result | View; download their own report card; upload files |
| **employee** | Only their own result | Download their own report card |

**How the app decides someone's role** (checked in this order):

1. Their email appears in the `ACCESS_ADMIN_EMAILS` setting → **admin**.
2. Their email appears in the `ACCESS_PROFILES_JSON` setting (or `ACCESS_MANAGER_EMAILS` for managers) → the role given there. No addresses are hard-coded.
3. Their email has a row in the `allowed_emails` table in Supabase → the role stored there.
4. Otherwise: if open signup is on (`ACCESS_OPEN_SIGNUPS`, **off by default**) they are let in as a plain **employee**; if it is off they are refused.

### Creating accounts for employees

There is no self-signup. An administrator creates accounts with `scripts/provision-accounts.mjs`:

1. Run `supabase/migrations/202610020001_allowed_emails_position.sql` once (adds the `position` column).
2. Prepare a CSV (see `scripts/people.example.csv`): `email,name,employee_id,position,role`. Real CSVs are git-ignored.
3. Dry run, then apply (the service-role key and default password live only in your shell):
   ```bash
   export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DEFAULT_EMPLOYEE_PASSWORD=...
   node scripts/provision-accounts.mjs people.csv            # preview, writes nothing
   node scripts/provision-accounts.mjs people.csv --apply    # create accounts + access rows
   ```
4. Every new account has its email pre-confirmed and is flagged `must_change_password`: on first sign-in the person is sent to `/change-password`, and the server refuses all data until they choose their own password.
5. Existing accounts keep their password; re-running is safe. Admin rows are never demoted without `--allow-demote`.
6. In Supabase, turn off Authentication > Sign In / Providers > "Allow new users to sign up".

Employees (`employee` role) can see only their own score and download only their own report card.

Sign-in itself uses Supabase (email and password). The dashboard pages are protected by an `_authenticated` route that redirects to `/auth` if nobody is signed in.

---

## 4. Tech stack

| Layer | Technology |
|---|---|
| Framework | TanStack Start (React 19, TanStack Router, server functions) |
| Build / server | Vite 8, Nitro (Vercel preset) |
| Styling | Tailwind CSS 4, shadcn/ui components (Radix) |
| Charts | Recharts |
| Sign-in and database | Supabase (Auth + Postgres) |
| Data source | Google Sheets API and Google Drive API, via a service account |
| PDF creation | `pdf-lib` |
| AI assistant | Vercel AI SDK with any OpenAI-compatible provider (optional) |
| Hosting | Vercel |

---

## 5. Repository map

```
src/
  routes/
    __root.tsx                    page shell and error handling
    index.tsx                     landing page
    auth.tsx                      sign in / sign up
    _authenticated/
      route.tsx                   guard: redirects to /auth if not signed in
      dashboard.tsx               the main dashboard page
    api/
      dashboard.ts                dashboard data endpoint
      report-card.ts              report-card PDF download
      director-ratings.ts         read/save the monthly director rating
      director-rating-details.ts  read/save per-KRA rating details
      public/cron/process-queue.ts  the queue processor entry point
  components/
    dashboard/                    every screen section (cards, charts, uploads, admin panel, chat)
    ui/                           generic building blocks (buttons, dialogs, tables…)
  lib/
    hr.functions.ts               server functions the browser calls (uploads, access, reports)
    hr.server.ts                  reads the Sheet and builds the dashboard data
    hr-types.ts                   shared TypeScript types + the red/yellow/green rule
    sheets.server.ts              thin wrapper around the Google Sheets API
    drive.server.ts               thin wrapper around the Google Drive API
    google-auth.server.ts         signs in to Google as the service account
    assistant.server.ts           the AI assistant
    cron/                         everything the queue processor runs (section 6.4)
    fallback.server.ts            serves the saved JSON snapshots (section 12)
  data/                           saved JSON snapshots of dashboard data and report PDFs
  integrations/supabase/          Supabase clients, sign-in middleware, generated types
supabase/
  migrations/                     database structure, in order
```

Files ending in `.server.ts` only ever run on the server. They contain secrets and are never sent to the browser.

---

## 6. How the main flows work

### 6.1 Showing the dashboard

1. The browser opens `/dashboard`. The route guard confirms the user is signed in.
2. The page asks the server for data (`getDashboard`).
3. The server works out the user's role (section 3).
4. For an **admin** it calls `loadDashboard(month)`, which reads the database (no Google involved): the `employees` roster, that month's `attendance_records` and `monthly_scores`, and any director ratings.
5. The month list is built from the data: every month from the first one on record to the current month, newest first. With no month chosen (or an unknown one) the newest month that has data is shown. Nothing about July or August is hardcoded.
6. It builds one record per employee: score (empty until the month is scored), RAG colour, ranks, breakdown, criteria, attendance figures computed from the daily records, and DPR activity from the latest Claude audit. Only people who appear in a month's data are listed for that month.
7. Managers and employees get a trimmed version containing only what they are allowed to see.

The pure assembly step lives in `src/lib/dashboard-build.ts` (unit-tested); `src/lib/hr.server.ts` only fetches rows.

### 6.2 Uploading files

There are two upload cards: **attendance** and **WhatsApp export** (a `.txt`, tagged with the group: Designers or Supervisors).

**Attendance (database queue, no Google).** Upload the biometric *Organization-Wise Attendance* report as a **PDF or an Excel (.xlsx)** file. There is no month to pick: it is read from the report title.

1. The server checks the sign-in and role (managers and admins only) and checks the file by its bytes (PDF or xlsx), not its name.
2. The raw file is stored in the private Supabase Storage bucket `attendance-uploads` and a row is added to `attendance_uploads`.
3. A job of type `attendance.import` is added to the `jobs` table, and the worker runs it immediately, so the result normally comes back in the same request. If it is still running the card polls the job every 3 seconds.
4. The worker (`src/lib/attendance/import.server.ts`) parses the file (`parse-xlsx.server.ts` / `parse-pdf.server.ts`), maps every person to an employee, and saves all records in **one transaction** (`import_attendance_records`). Re-uploading a month replaces it; it never duplicates.
5. Mapping order: ignore list (`attendance_exclusions`, e.g. the driver), then biometric id (`employees.cosec_id`), then exact name, then a known spelling (`employee_aliases`). A near-miss is only ever *suggested*, never linked automatically. Anyone not recognised is saved unmapped and shown on the card; an admin links them to an employee or excludes them.
6. The card shows the detected month, rows saved, who matched, who needs a decision, parser warnings, and each person's present / half / absent / leave days and average hours.

How a day is classified (from the two half-day codes): `PR+PR` Present, one `PR` Half Day, any `IN` Incomplete, `AB+AB` Absent, `WO+WO` Week Off, `PH` Holiday, leave codes Leave. Present, Half Day and Incomplete all count as **present days** (the convention the tracker has always used).

**WhatsApp export (unchanged).** The file goes to a Drive folder and one row is appended to the `Control` tab; the browser polls that row every 18 seconds. The upload only *queues* the work.

### 6.3 Creating report cards

1. An admin presses **Create Report** (or **Finalize month**) for a month.
2. The server adds a `report.generate` job to the database queue and runs the worker straight away. No Google Sheet or Drive is involved.
3. The worker builds every employee's report card PDF from that month's scores and stores them in the private Supabase Storage bucket `report-cards` (`<yyyy-mm>/<employee id>.pdf`).
4. The dashboard polls the job and says when it is done. Cards are downloaded from each employee's detail view.

### 6.4 The queue processor (where the work actually happens)

The processor is a web address: `/api/public/cron/process-queue`. Something outside this repository must call it on a schedule. It accepts a call only with `Authorization: Bearer <CRON_SECRET>`.

Each call first drains the **database job queue** (`jobs` table, `src/lib/jobs/`): it claims jobs one at a time with `claim_job()` (`FOR UPDATE SKIP LOCKED`, so workers never take the same job), retries failures with backoff (1, 2, 4 minutes, 3 attempts), and re-queues a job whose worker died. To add a background task, add one line to `HANDLERS` in `src/lib/jobs/worker.server.ts`. This is also what retries an attendance import that did not finish inside the upload request.

It then runs the older Google-Sheet `Control` queue, which still carries report cards and WhatsApp exports:

1. Makes sure the `Control` tab has its extra columns.
2. Reads the queue and picks **one** row: the first `PENDING` one, or a `PROCESSING` one that has not been touched for over 90 minutes (assumed abandoned).
3. Marks it `PROCESSING` and stamps the time.
4. Runs the job for its type:

| Type | What it does |
|---|---|
| **Attendance Upload** | No longer handled here. A leftover request from the old flow is marked `FAILED` with a message to re-upload. |
| **WhatsApp Export** | Marks the row `DONE` right away. Real processing is done by an outside automation. |
| **Create Report** | No longer handled here (report cards are a database job now). A leftover request is marked `FAILED` with a message to press Create Report again. |

5. Marks the row `DONE` or `FAILED` (with a reason in the *Error Notes* column).
6. **Switched off by default:** the old Drive-to-Sheet activity-log sync and the monthly EA follow-up scoring. Scores no longer depend on them (DPR evidence now arrives in the Claude post; ratings live in the database). Set `LEGACY_SHEET_JOBS=true` to run them again.

Because each call handles only one row, several queued requests take several calls.

### 6.5 Director ratings

Admins rate every KRA parameter (0–5) for every employee in the **Director Ratings** panel. The parameters and their weights per role live in the `kra_parameters` table (seeded from the old sheet). Opening a month creates one **blank** row per employee per parameter, so the panel is never empty. A blank rating means *not rated yet*, which is different from a real 0. Saving recalculates the month's scores. There is no history of previous values.

### 6.6 Report cards (PDFs)

When someone downloads a card (`/api/report-card`) the server picks the first that applies:

1. **A hand-made PDF** stored as base64 text in `src/data/` (July and August 2026, created outside the app).
2. **The stored PDF** for a *finalized* month, exactly as it was when the month was locked.
3. **A freshly generated PDF** (`src/lib/report/report-card.server.ts`), laid out like the July cards: score-proportional top bar, final-score box with a 0 / 60 / 75 / 100 gauge, "How this score was built" bars each with a one-line explanation, KRA rating dots with "NOT YET RATED" chips, "Why this score", "What to improve next month", and an optional evidence page (attendance calendar and graded DPR days).
4. Access rule: admins may download anyone's card; everyone else only their own.

The dashboard's employee panel and the PDF are drawn from the **same model** (`ScoreCardModel`, `src/lib/scoring/score-card.ts`), so they cannot disagree.

### 6.7 The AI assistant

Admins can ask questions in the chat box. The server loads the dashboard data, sends a compact copy of it to the configured AI provider with strict instructions (answer only from this data, read-only, say so if unknown), and returns the answer. If `OPENAI_API_KEY` is not set, the feature simply reports that it is not configured.

---

## 7. How scores are calculated

**The backend now calculates every score** (`src/lib/scoring/`, pure and unit-tested). It is a direct port of the formulas in the old KRA sheet, plus two changes: a transparent raw-attendance blend, and a work-visibility penalty. Months scored in the old sheet (July, August 2026) are kept exactly as saved.

**Inputs:** (1) attendance from the biometric upload, (2) the monthly Claude audit (DPR days graded, designer coordination, activity days), (3) director ratings entered in the dashboard. Scores recompute automatically whenever any of them changes and show **Pending** (naming what is missing) until all are in. An admin presses **Finalize month** to freeze the scores and store the report cards; **Reopen** undoes it.

**Raw attendance** = 70% presence + 20% hours + 10% punctuality.
- Presence: days attended (present, half day or missing punch) ÷ working days (calendar days minus Sundays).
- Hours: average worked hours on attended days ÷ 9, capped at 100%.
- Punctuality: share of attended days arriving by the shift's start time plus grace (`shift_rules` table, seeded 10:00 + 15 minutes for every shift).

**Work-visibility rule.** A day counts as visible only if the person was present *and* left a real update that day. Adjusted attendance = raw × (visible days ÷ present days). Supervisors: a non-blank DPR filed that day (a DPR filed on a day off offsets nothing; blank templates do not count). Designers and EA: Rdash activity days if the audit supplies them, never below 50%; no data means no penalty.

**Section scores**
- DPR Combined = coverage × 40% + quality × 60% (coverage = distinct filing days ÷ working days; quality = average of Excellent 100 / Good 75 / Partial 50 / Poor 25).
- Coordination (designers) = share of revision/markup tasks closed, from the audit.
- System Work Feedback = Σ(weight × rating) ÷ 5 × 100. An unrated parameter counts as 0, and the score stays Pending until every parameter is rated.

| Role group | Attendance | DPR Combined | Coordination | System Work Feedback |
|---|---|---|---|---|
| **Supervisor** | 30% (visibility-adjusted) | 50% | – | 20% |
| **Designer** | 25% | – | 40% | 35% |
| **Designer, no coordination tasks** | 50% | – | – | 50% |
| **Executive Assistant (EA)** | 60% | – | – | 40% |

Ranks are within the role group (all designers together) and company-wide; Top 3 is overall rank 1 to 3.

**Red / yellow / green** (from the final score):

| Colour | Score |
|---|---|
| RED — needs attention | below 60% |
| YELLOW — on track | 60% up to 75% |
| GREEN — strong | 75% or above |

The exact payload the Claude task must post, and the updated task prompt, are in `docs/claude-monthly-audit-prompt.md`.

---

## 8. The Google Sheet

The spreadsheet ID is `11gz8_k0o12efp-Mh2rhQZGCOl0ZcksgEDpo0QpqLNCs`. Access is private and given to a service account.

| Tab | Purpose | App access |
|---|---|---|
| Employee Master | Name, role, department, manager, join date | read |
| Supervisor KRA / Designer KRA / EA KRA | Per-person KRA parameters, weights, ratings, and a TOTAL row | read |
| Monthly Summary | The review month and totals | read |
| Daily Attendance | One row per person per day | read; **rows appended** by the processor |
| Raw Data | Source figures | read |
| DPR Activity Log / Task Activity Log | Day-by-day DPR and task detail | appended by the processor |
| Automation State | Small key/value memory ("what did we already do this month") | read/write |
| **Control** | The job queue | read/write |

**The `Control` tab** has its header on row 3 and data from row 4:

| Column | Meaning |
|---|---|
| A Request ID | unique ID |
| B Requested At (UTC) | when it was queued |
| C Requested By | email of the requester |
| D Month | e.g. "August 2026" |
| E Status | `PENDING` → `PROCESSING` → `DONE` or `FAILED` |
| F Drive Folder Link | the uploaded file, then the result folder |
| G Completed At (UTC) | when it finished |
| H Type | Create Report / Attendance Upload / WhatsApp Export |
| I Last Touched At (UTC) | used to detect abandoned jobs |
| J Error Notes | failure reason, or a note on partial success |

The app finds columns by their **header text** and by fixed cell ranges, so renaming a header, moving a column or adding rows above the header can silently change what the app reads.

---

## 9. The Supabase database

| Table | Purpose |
|---|---|
| `allowed_emails` | Who may sign in and with what role (`admin`, `manager`, `employee`), plus the matching employee ID and name. Row-level security lets a user read only their own row. |
| `monthly_director_ratings` | One row per month and employee: a 0–100 director rating and notes. Admin-only access. |
| `employees` | The roster: id (`DLB-SUP-01`), name, role, group, department, manager, biometric id (`cosec_id`). Seeded by the migration. |
| `employee_aliases` | Other spellings of a name (`sushovan haldar` maps to Susovan Haldar). |
| `attendance_exclusions` | Biometric ids ignored entirely (the driver). |
| `attendance_uploads` | One row per uploaded file: format, detected period and months, status, parse statistics, who uploaded. The raw file is in the `attendance-uploads` Storage bucket. |
| `attendance_records` | One row per person per day: punches, half-day codes, normalised status, late/early/work minutes, manual-entry flag and reason. Unique on (date, biometric id). |
| `monthly_scores` | One row per employee per month: final score, RAG, ranks, breakdown, criteria, audit details. Filled by the Claude audit (`/api/public/rdash-ingest`) or the one-off legacy import. |
| `jobs` | The background job queue. |
| `monthly_director_rating_details` | One row per month, employee and KRA parameter: rating 1–5, weight, weighted score, source tab, notes. Admin-only access. |

All of the new tables are server-only (row-level security on, no policies). After applying the migration, regenerate `src/integrations/supabase/types.ts`; until then the code reaches these tables through an untyped client.

**Moving July and August out of the old spreadsheet snapshots:** after the migration, run `npm run import:legacy -- --dry-run`, then `npm run import:legacy`. It is safe to repeat: it never overwrites existing scores and leaves any month that already has attendance alone.

**Claude audit and the backend.** `POST /api/public/rdash-ingest` stores the payload and also writes each person's score into `monthly_scores` (matched by name or alias), so the dashboard shows it. `GET /api/public/attendance-summary?month=September 2026` (same `x-ingest-key`) returns every person's present, half, absent and leave days, average hours and punctuality, so the audit no longer needs an `attendance_summary.json`.

Supabase Auth manages the actual accounts and passwords. The `supabase/migrations/` folder holds the structure, in order. Nothing applies these migrations automatically — they are run by hand.

---

## 10. Configuration (environment variables)

Names only — **never commit real values.** A template is in `.env.example`. Copy it to `.env.local` and fill it in; `.env.local` is ignored by git. (A committed `.env` with only public browser values exists on `main`; never put secrets in it.)

| Variable | Used for |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` | Browser-side Supabase connection (safe to expose) |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Server-side Supabase connection |
| `SUPABASE_SERVICE_ROLE_KEY` | Full database access on the server only. Highly sensitive. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` (or `..._B64`) | Google credentials. Server only. |
| `GOOGLE_SHEET_ID` | Which spreadsheet to use |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Parent folder for all created folders |
| `GOOGLE_DRIVE_AUGUST_REPORT_FOLDER_ID` | Folder used for the August report cards |
| `CRON_SECRET` | Bearer token required by `/api/public/cron/process-queue` |
| `ACCESS_ADMIN_EMAILS`, `ACCESS_MANAGER_EMAILS` | Comma-separated admin / manager emails (no hard-coded defaults) |
| `RDASH_INGEST_KEY` | Shared secret for `/api/public/rdash-ingest` |
| `ACCESS_OPEN_SIGNUPS` | `true` lets any confirmed account in as an employee; default is closed |
| `ACCESS_ADMIN_EMAILS` | Comma-separated admin emails |
| `ACCESS_PROFILES_JSON` | Extra role assignments per email |
| `ACCESS_OPEN_SIGNUPS` | `true` to let any confirmed account in; defaults to closed |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | Optional AI assistant |

Anything starting with `VITE_` is baked into the browser code. Everything else stays on the server.

---

## 11. Running, building and deploying

You need Node.js 20 or newer and pnpm.

```sh
pnpm install     # install dependencies
pnpm dev         # run locally
pnpm build       # production build
pnpm lint        # style / lint checks
```

**Deploying:** pushing to `main` on GitHub triggers Vercel to build and deploy. Environment variables are set in the Vercel project for Production, Preview and Development, and a change requires a redeploy. There is no automated test or build check on pull requests in this repository.

**Database changes:** migrations in `supabase/migrations/` must be applied to Supabase manually (SQL Editor or the Supabase CLI). Deploying the app does not apply them.

---

## 12. Known limitations and gotchas

Being upfront about these so nobody is surprised.

**Data**
- **The Google Sheet has no safety net.** No transactions, no locking, no version history. Cells are read by position and header text, so an accidental edit can change numbers without any error.
- **August 2026 is always served from a saved snapshot** in `src/data/`, never from the live Sheet. July tries the live Sheet first and falls back to its snapshot if Google fails. The dashboard does **not** tell the viewer when it is showing a snapshot.
- **Only two months are supported in code** (`July 2026`, `August 2026`). Other months requested by the UI silently load the default.
- **Real HR data is stored in the repository** (`src/data/*.json`, about 390 KB, including report-card PDFs). This is a privacy concern.

**Scoring**
- **The scoring formulas live in the spreadsheet and are not documented or tested.** The app cannot verify them.
- Only three role groups exist. Anyone else is scored as an EA.
- The follow-up scoring is hard-wired to one named person.

**Queue processor**
- **Nothing in this repo triggers it.** Whoever calls it on a schedule is configured elsewhere.
- One row per call, no automatic retries for `FAILED` rows (someone resets the status to `PENDING`), and two overlapping calls can pick the same row.
- A slow job (over 90 minutes) can be picked up a second time.
- It requires `Authorization: Bearer <CRON_SECRET>`. Replace the existing pg_cron job in one step (same job name updates it, so there is no gap), substituting the real secret:
  ```sql
  select cron.schedule('decorlab-process-queue', '*/20 * * * *', $$
    select extensions.http_post(
      url := 'https://decorlab-hr.vercel.app/api/public/cron/process-queue',
      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
      body := '{"source":"pg_cron"}'::jsonb, timeout_milliseconds := 60000) $$);
  ```

**Uploads**
- The PDF carries clock times without dates, so a night-shift punch that belongs to the previous evening is placed on the row's own date. The Excel export has real dates, so prefer it. Both formats are tested to produce identical records otherwise.
- A month has no score until a Claude audit for it is posted (or the legacy import ran). Attendance figures show immediately.

**Access**
- Signup is closed by default; set `ACCESS_OPEN_SIGNUPS=true` to let any confirmed account in as an employee.
- Role checking lives in one place, `src/lib/access.server.ts`.

**Ratings**
- Director ratings are overwritten in place. There is no edit history.

**Operations**
- Tests: `npm test` runs the parsers on real sample files, name matching, the migration and queue on an in-process Postgres, the legacy import and the full upload-to-dashboard flow. No CI yet. One lockfile (`pnpm-lock.yaml`); migrations are applied by hand.

---

## 13. Where this is heading

The plan under discussion replaces the "Sheet as database and queue" design with:

1. An **ingest endpoint** (`POST /api/public/rdash-ingest`, header `x-ingest-key` equal to `RDASH_INGEST_KEY`, 256 KB body cap) that stores what the scheduled Claude task sends in `rdash_ingests`.
2. A **real database** holding DPR entries, attendance, director ratings and scores.
3. The dashboard showing what is already present and **asking only for what is missing** (attendance, director rating). The *Generate report* button stays disabled until everything is there.
4. **Queued jobs** that calculate scores per role in parallel, build the PDFs, and send them out (WhatsApp / email) with status tracking.
5. Scoring formulas written down as tested code, checked against the Sheet for at least one month before switching.

A first, unfinished piece of this exists in the working tree: `src/routes/api/public/rdash-ingest.ts` and its migration `supabase/migrations/202609290001_create_rdash_ingests.sql`. The table migration must be applied by hand, and the endpoint has not yet been tested end to end.

---

## 14. Glossary

| Term | Meaning |
|---|---|
| **KRA** | Key Result Area — the criteria a person is rated on |
| **DPR** | Daily Progress Report filed by site supervisors |
| **RAG** | Red / Amber (here Yellow) / Green rating |
| **EA** | Executive Assistant |
| **Control tab** | The sheet tab used as the job queue |
| **Queue processor** | The web address that handles one queued request per call |
| **Service account** | A robot Google identity the app uses to read and write the Sheet and Drive |
| **Snapshot / fallback** | Saved JSON copies of the dashboard data used when Google can't be reached |
| **Upsert** | "Insert, or overwrite if it already exists" |
| **Row-level security (RLS)** | Database rules deciding which rows each user may read or change |
| **Server function** | Code that runs on the server but is called from the browser as if it were a normal function |
