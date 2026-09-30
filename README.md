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
4. For an **admin** it calls `loadDashboard(month)`, which asks Google for these ranges in one batch:
   `Monthly Summary`, `Employee Master`, `Supervisor KRA`, `Designer KRA`, `EA KRA` and `Daily Attendance`.
5. It builds one record per employee: score, RAG colour, ranks, the score breakdown, criteria ratings, attendance figures, and DPR / task activity.
6. Managers and employees get a trimmed version containing only what they are allowed to see.
7. If Google cannot be reached, the app quietly uses a saved JSON snapshot instead (see section 12).

### 6.2 Uploading files

There are two upload cards: **attendance** (a PDF) and **WhatsApp export** (a `.txt`, tagged with the group: Designers or Supervisors).

1. The browser checks the file type and a 20 MB limit, turns the file into base64 text, and sends it to the server.
2. The server checks the sign-in and role (managers and admins only; employees are refused), validates the month label, then finds or creates a Drive folder named `<Month> - Attendance Uploads` or `<Month> - WhatsApp Exports`.
3. It uploads the file there.
4. It appends **one row to the `Control` tab**: a new request ID, the time, who asked, the month, the status `PENDING`, the Drive link and the request type.
5. The browser then checks that row every 18 seconds and shows a message when it turns `DONE` or `FAILED`.

Nothing is processed yet at this point. The upload only *queues* the work.

### 6.3 Creating report cards

1. An admin presses **Create Report** for a month.
2. The server appends a `PENDING` row of type "Create Report" to `Control`. There is no file.
3. The same 18-second polling starts.

### 6.4 The queue processor (where the work actually happens)

The processor is a web address: `/api/public/cron/process-queue`. Something outside this repository must call it on a schedule. It accepts a call only with `Authorization: Bearer <CRON_SECRET>`.

Each call does the following:

1. Makes sure the `Control` tab has its extra columns.
2. Reads the queue and picks **one** row: the first `PENDING` one, or a `PROCESSING` one that has not been touched for over 90 minutes (assumed abandoned).
3. Marks it `PROCESSING` and stamps the time.
4. Runs the job for its type:

| Type | What it does |
|---|---|
| **Attendance Upload** | Downloads the file from Drive and reads it as a table. Appends the rows to the `Daily Attendance` tab. **PDFs are refused on purpose** (the row becomes `FAILED`) because reading numbers out of a PDF risks silent errors. It needs a CSV or a Google Sheet with the columns Date, Day, Employee Name, Status, In Time, Out Time, Hours Worked. |
| **WhatsApp Export** | Marks the row `DONE` right away. Real processing is done by an outside automation. |
| **Create Report** | Loads the dashboard data, builds a one-page PDF per employee, uploads them to a `<Month> - Report Cards` Drive folder, and marks the row `DONE` with the folder link. If more than half fail, the row is `FAILED`. |

5. Marks the row `DONE` or `FAILED` (with a reason in the *Error Notes* column).
6. **Every call also** syncs activity logs and scores follow-ups:
   - It looks in a Drive staging folder for files named `DPR Activity Log - <Month>` and `Task Activity Log - <Month>` and appends them to the Sheet. This is how DPR and task data reach the dashboard today.
   - Once per month it reads the follow-up trackers and gives the Executive Assistant a follow-up discipline rating, remembering the month in an `Automation State` tab so it isn't repeated.

Because each call handles only one row, several queued requests take several calls.

### 6.5 Director ratings

Admins can enter a **director rating** per employee per month (0–100) with notes, and a more detailed rating **per KRA parameter** (0–5). Both are saved straight into Supabase tables using an "upsert": if a rating for that month and employee already exists it is overwritten; otherwise it is created. There is no history of previous values.

### 6.6 Report cards (PDFs)

A report card can come from three places. When someone downloads one (`/api/report-card`), the server picks the first that applies:

1. **A saved PDF** stored as base64 text inside `src/data/` (one set for July, one for August 2026). These were created outside the app.
2. **A freshly generated PDF**, drawn by `pdf-lib` in `lib/cron/report-pdf.server.ts`: a navy and gold header, name and role, final score and RAG, ranks, the weighted breakdown, criteria, attendance and a note.
3. Access rule: admins may download anyone's card; everyone else only their own.

### 6.7 The AI assistant

Admins can ask questions in the chat box. The server loads the dashboard data, sends a compact copy of it to the configured AI provider with strict instructions (answer only from this data, read-only, say so if unknown), and returns the answer. If `OPENAI_API_KEY` is not set, the feature simply reports that it is not configured.

---

## 7. How scores are calculated

**The app does not calculate the section scores.** The spreadsheet does. Each employee has a "TOTAL" row on their KRA tab, and the app reads figures from that row and applies fixed weights.

| Role group | Attendance | DPR Combined | Coordination | System Work Feedback |
|---|---|---|---|---|
| **Supervisor** | 30% (discipline-adjusted) | 50% | – | 20% |
| **Designer** | 25% | – | 40% | 35% |
| **Executive Assistant (EA)** | 60% | – | – | 40% |

Any role that is not "supervisor" or "designer" is treated as EA. There is no separate formula for other roles.

**Red / yellow / green** (from the final score):

| Colour | Score |
|---|---|
| RED — needs attention | below 60% |
| YELLOW — on track | 60% up to 75% |
| GREEN — strong | 75% or above |

**What the section names mean** (as described in the report cards; the actual formulas live in the Sheet):

- **DPR** = Daily Progress Report filed by supervisors. *DPR Combined* blends coverage (share of working days with a report) and quality (how useful the reports were).
- **Discipline-adjusted attendance** reduces attendance when someone was present but did not file a DPR.
- **Coordination** (designers) is roughly the share of revision tasks completed during the month.
- **System Work Feedback** is the manager's 1–5 ratings converted to a percentage.

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
| `monthly_director_rating_details` | One row per month, employee and KRA parameter: rating 1–5, weight, weighted score, source tab, notes. Admin-only access. |

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
- **The attendance card asks for a PDF, but the processor rejects PDFs.** Every attendance upload from the current UI ends as `FAILED` with a message asking for a CSV or Google Sheet.

**Access**
- Signup is closed by default; set `ACCESS_OPEN_SIGNUPS=true` to let any confirmed account in as an employee.
- Role checking lives in one place, `src/lib/access.server.ts`.

**Ratings**
- Director ratings are overwritten in place. There is no edit history.

**Operations**
- No automated tests, no CI, one lockfile (`pnpm-lock.yaml`), and migrations are applied by hand.

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
