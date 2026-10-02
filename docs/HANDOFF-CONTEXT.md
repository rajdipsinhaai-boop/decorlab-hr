# Decorlab HR dashboard: handoff context (as of 2026-10-02/03)

Paste this into a new chat. It is a snapshot of what exists, what was decided, and what is open. No secrets are in it.

## 1. What this project is
- Private HR performance dashboard for **Decorlab** (Kolkata interior-design firm). Stack: TanStack Start + React 19, Vite 8, Nitro (Vercel preset), Supabase (Postgres, Auth, Storage), pdf-lib, recharts, vitest.
- Repo: `C:\Users\rumma\OneDrive\Documents\Desktop\decorlab\decorlab-hr` (Windows; Git Bash + PowerShell). Branch `readme` (4 commits ahead of origin) with **many uncommitted changes. Nothing from this work is committed or pushed.**
- Roles: `admin` (Rajdip and leadership), `manager`, `employee`. Role comes from `ACCESS_ADMIN_EMAILS` env, or the `allowed_emails` table. An earlier bug showed admins as "Employee" while loading or on error; fixed (shell now says "Checking access…").
- People (12 scored): Supervisors Gouranga Panrui, Susovan Haldar, Sibhu Das, Arunava Mallick, Ranjan Maity, Subhajit Bhawal, **Sukhendu Das** (on roster because August scored him; the user's audit prompt said exclude, decision still open). Designers Bhavana Agarwal, Asif Ali Khan, Shibnath Mondal, Deep Das. EA Priyanka Dalapati. Driver Santosh Kumar Yadav (biometric id D112) is excluded entirely.

## 2. Environment gotchas (important)
- **Two Supabase projects.** `junxqhokakrxgnlcwmag` = the real one (set in git-ignored `.env.local`, which overrides `.env`). `wwluygiepbezyuvwoxur` = old project, still in `.env`. Local scripts must read both: `node --env-file=.env --env-file-if-exists=.env.local ...`.
- **Vercel env vars must point at the `junxq...` project** (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY) plus RDASH_INGEST_KEY, CRON_SECRET, ACCESS_ADMIN_EMAILS. Not yet verified by the user.
- **Secrets leaked in git history:** `.env` was tracked since Aug; contains `RDASH_INGEST_KEY` and `CRON_SECRET`. `.env` is now untracked in the index (staged deletion, uncommitted). User must **rotate both keys**. History rewrite NOT done (needs explicit go-ahead; would force-push main/readme/push-ready).
- Keys are new-style `sb_secret_...`: they go in the `apikey` header only, never as a Bearer token (the app's clients and the scripts already handle this).
- Tooling notes: no global pnpm (use `npx pnpm@10`; lockfile edits via `--lockfile-only`, node_modules via `npm install --no-save --legacy-peer-deps`). The bash tool chokes on big heredocs containing quotes; use file Write/Edit tools or small python scripts instead. `git stash` was used once by mistake and restored cleanly; avoid it.
- Pre-existing, unrelated type errors remain (google-auth.server.ts x2, three `/api/*` route middleware typings). Everything new is type-clean. Lint output is mostly CRLF/prettier noise on new files. New tables are accessed through `(supabaseAdmin as any)` until `src/integrations/supabase/types.ts` is regenerated.

## 3. Database (Supabase `junxq...`)
Migrations in `supabase/migrations/` (applied by hand in the SQL editor; do **not** use `npm run migrate`/`db push`, it may re-run old ones):
- `202610020002_attendance_pipeline.sql` **applied** (employees, employee_aliases, attendance_exclusions, attendance_uploads, attendance_records, monthly_scores, jobs, `claim_job()`, `import_attendance_records()`, `review_months()`, private bucket `attendance-uploads`, roster seed with biometric ids D100..D116, aliases, D112 excluded).
- `202610030001_scoring.sql` **applied** (verified: `kra_parameters` and blank rating rows exist). Adds `shift_rules` (now superseded), `kra_parameters` (19 rows: supervisor 7, designer 6, ea 6, weights sum to 1 per role), `month_locks`, nullable `monthly_director_rating_details.rating_1_to_5`, private bucket `report-cards`.
- `202610030002_duty_rules.sql` **status unconfirmed**: SQL was copied to the user's clipboard; ask whether it was run. Creates `duty_rules` (supervisor 11:00, designer 10:00, ea 10:00; grace 30; required 510 min) and drops `shift_rules`. Code falls back to the same defaults if the table is missing/empty, but `loadDashboard`/`computeMonth` query `duty_rules` and would error if it does not exist: **verify it exists**.
- Tables from earlier work: `allowed_emails`, `monthly_director_ratings`, `monthly_director_rating_details`, `rdash_ingests` (Claude payloads).
- **Legacy import done:** `npm run import:legacy` loaded July (11 scores, 341 attendance rows) and August (12 scores, 372 rows) from the old sheet snapshots into `monthly_scores` (source `legacy-sheet`) and `attendance_records`. Verified equal to the sheet (averages 52.26 and 69.83). These months are never recomputed.
- Current September state (read from prod): attendance uploaded (360 rows, 12 people mapped, driver excluded); `monthly_scores` rows exist but all **pending**; all 6/7 KRA rating rows per person exist and are **blank**; no month locks. The user deleted/re-ran the Claude ingest (gave SQL to delete from `rdash_ingests`), so whether a September audit is on file is unknown.
- Stored September score rows were computed **before** the duty-rule change (notes still say "against 9h"). **Press Recalculate** to refresh.

## 4. Data flow today (no Google Sheet in the score path)
1. **Attendance:** admin/manager uploads the biometric "Organization-Wise Attendance" report (PDF or xlsx) on the dashboard. Month is read from the report title. Stored in bucket `attendance-uploads`; job `attendance.import` in `jobs`; worker parses (`src/lib/attendance/parse-*.server.ts`), maps people (cosec id, then name, then alias; near-misses only suggested), saves in one transaction, then **recomputes the month**. Both parsers were tested to give identical records on the real September files (only 2 night-shift punch dates differ in the PDF).
2. **Claude monthly audit** POSTs to `/api/public/rdash-ingest` (header `x-ingest-key` = `RDASH_INGEST_KEY`). Payload stored in `rdash_ingests`; the month is recomputed. Contract and the full updated task prompt: `docs/claude-monthly-audit-prompt.md`. Claude supplies evidence only: DPR days graded (with `blank` flag), designer `coordination_pct` + basis, `activity_days`, optional `comments`. It must NOT send scores, attendance, `manager_ratings`.
3. **Director ratings:** Director Ratings panel; opening a month creates blank rows per person per KRA point from `kra_parameters`; blank = not rated (different from 0); saving recomputes.
4. **Compute:** `computeMonth(monthKey)` in `src/lib/scoring/compute.server.ts` -> `planMonthScores` -> upserts `monthly_scores` (source `computed`). Skips finalized months and months that have legacy-sheet scores. Admin buttons: **Recalculate**, **Finalize month** (locks, generates and stores 12 report-card PDFs in bucket `report-cards`; warns if anyone is Pending), **Reopen**.
5. **Cron:** `/api/public/cron/process-queue` (Bearer `CRON_SECRET`) drains the `jobs` queue (retries/backoff, crash recovery), then the legacy Control-sheet queue (WhatsApp exports only now; legacy attendance/report requests are marked FAILED with a message). Old sheet jobs (activity-log sync, EA follow-ups) are OFF unless `LEGACY_SHEET_JOBS=true`.
6. **Still on Google by choice:** WhatsApp export upload (Drive folder + Control sheet row), because an external automation reads it.
7. `GET /api/public/attendance-summary?month=September 2026` (same ingest key) returns per-person attendance for the Claude task.

## 5. Scoring rules (implemented in `src/lib/scoring/`, pure and unit-tested)
- Final score formulas (ported exactly from the old sheet; reproduce all 23 July/August scores, ranks, Top 3, zones, company averages):
  - Supervisor = Adjusted Attendance x 30% + DPR Combined x 50% + Feedback x 20%
  - Designer = Attendance x 25% + Coordination x 40% + Feedback x 35% (no coordination tasks: Attendance x 50% + Feedback x 50%)
  - EA = Attendance x 60% + Feedback x 40%  (**open question: user said the EA is "completely on director rating"; if they want 100% director rating, change it**)
  - DPR Combined = coverage x 40% + quality x 60%; coverage = distinct filing days / working days; quality = avg of Excellent 100 / Good 75 / Partial 50 / Poor 25; last filing of a day wins.
  - Feedback % = sum(weight x rating)/5 x 100; unrated counts as 0 and the score stays **Pending** until every KRA point is rated.
  - RAG: <60 RED, <75 YELLOW, else GREEN. Working days = calendar days minus Sundays. Ranks competition-style within role group (all designers together) and overall; Top 3 = overall rank <= 3.
- **Raw attendance = 70% presence + 20% hours + 10% punctuality** (user chose these weights).
  - Presence = (Present + Half Day + Incomplete days) / working days.
  - Hours = average worked hours on attended days / **8.5h**, capped at 100%.
  - Punctuality = share of attended days that are "on time": arrived within **30-minute grace** of the role's start (designers and EA 10:00, supervisors 11:00) **or** completed the full **8h30** (late is fine if hours are made up).
- **Work-visibility penalty** (user's rule): Adjusted attendance = raw x (visible days / present days). Visible day = present AND a real update that day. Supervisors: a non-blank DPR filed that day (blank templates, and DPRs on days off, do not count). Designers/EA: Rdash `activity_days` if sent, floor 50%; no data = no penalty. Multiplicative like the old discipline rule.
- Comments: rules write why/improve bullets from the numbers; Claude's `comments` (DPR observations) are appended (room reserved). One `ScoreCardModel` drives both the dashboard panel and the PDF.
- Old facts: the sheet's raw attendance, DPR combined and coordination were typed by hand (no formula recoverable). The attached July Priyanka card says 66.8% but the sheet says 70.7% (PDF predates a rating update; DB keeps 70.7).

## 6. Report card
- `src/lib/report/report-card.server.ts` (pdf-lib), laid out like the July cards: score-proportional top bar, final-score box with 0/60/75/100 gauge, "How this score was built" bars with explanation lines, KRA dots with NOT YET RATED chips, Why / Improve, optional evidence page (attendance calendar + graded DPR days), footer "DECORLAB KRA - n / N". `src/lib/report/model-for.ts` rebuilds a card for legacy months. `/api/report-card` serves: hand-made PDFs for July/August, else the stored PDF of a finalized month, else generates on demand. Visually checked via pdftoppm against the July cards.

## 7. Dashboard UI (changed)
Month picker driven by data (July onward through current month, "no data yet" flagged; default = latest month with data); employee cards/detail handle Pending; **View attendance** panel (`AttendanceViewer.tsx`, any uploaded month, per-person table + day list); upload card with auto month, per-person result, unmatched people can be linked/excluded by admin; `MonthActions.tsx` (Recalculate/Finalize/Reopen); `ScoreCardView.tsx` in the employee dialog; Director Ratings panel rewritten (opens month, blank vs 0, completeness counts, locked state); `/api/dashboard` returns real error messages (e.g. missing migration).

## 8. Key files
- Attendance: `src/lib/attendance/{types,normalize,assemble,parse-xlsx.server,parse-pdf.server,parse.server,match,plan,metrics,import.server}.ts`
- Scoring: `src/lib/scoring/{types,constants,attendance-score,engine,narrative,score-card,plan-month,compute.server}.ts`, `src/lib/audit-ingest(.server).ts`, `src/lib/dashboard-build.ts`, `src/lib/hr.server.ts`, `src/lib/hr.functions.ts` (upload, job status, recalculate/finalize/reopen, openRatingMonth, saveDirectorRatings, resolveAttendanceIdentity)
- Jobs: `src/lib/jobs/{queue,worker}.server.ts` (handlers: `attendance.import`, `report.generate`)
- Report: `src/lib/report/*`; routes `src/routes/api/{dashboard,report-card}.ts`, `src/routes/api/public/{rdash-ingest,attendance-summary,cron/process-queue}.ts`
- Scripts/docs: `scripts/import-legacy.mjs`, `docs/claude-monthly-audit-prompt.md`, `README.md` (updated sections 6-9)
- Fixtures: `tests/fixtures/cosec-sept-2026.{pdf,xlsx}` (real September biometric report)

## 9. Verification status
- `npm test` (vitest): 8 files, **79 tests pass** (parsers vs real files, PDF/xlsx parity, name matching, migrations + queue on in-process Postgres (PGlite), legacy import, scoring engine incl. reproducing every old sheet score, visibility/duty rules, report PDFs, full upload->audit->ratings->dashboard flow).
- `npx tsc --noEmit`: only the pre-existing errors listed above. `npx vite build`: passes; exceljs and unpdf verified inside the server bundle.
- NOT verified in a browser (no login from the tooling): the new screens. NOT deployed.
- Commands: `npm test`, `npx tsc --noEmit -p .`, `npx vite build`, `npm run import:legacy -- --dry-run`.

## 10. Open items / next steps for the user
1. Confirm `202610030002_duty_rules.sql` was run (else run it); then press **Recalculate** for September.
2. Update the Vercel env vars (junxq project), rotate `RDASH_INGEST_KEY` + `CRON_SECRET` everywhere (Vercel, pg_cron job, Claude task), then **commit and deploy** (nothing is committed; ask before pushing). Decide on removing `.env` from git history.
3. Paste the new prompt from `docs/claude-monthly-audit-prompt.md` into the scheduled Claude task (posts to the production URL; key from env var `DECORLAB_INGEST_KEY`; no sheet steps; new fields). Re-fire and check payload appears.
4. Enter director ratings (they arrive 2026-10-03), review the computed September scores and penalties, then **Finalize month**.
5. Decisions still open: Sukhendu Das (keep/exclude); EA formula (60/40 vs fully director rating); confirm assumptions "designers 6:03pm" = 6:30pm and EA starts at 10:00; whether unrated KRA points should count as 0 (current, sheet behaviour); visibility penalty floor for supervisors (currently none: mostly blank DPRs can drop attendance credit to near 0); whether to keep the 50% designer floor; yearly-average view not built (needs the rule for unscored months/mid-year joiners); move WhatsApp off Drive?
6. Latest observed September raw attendance under the duty rules (before DPR penalty/ratings): Sukhendu 97.3, Arunava 94.6, Asif 92.3, Gouranga 89.2, Susovan 89.0, Sibhu 88.0, Deep 87.6, Shibnath 85.1, Bhavana 84.2, Ranjan 83.8, Subhajit 80.3, Priyanka 78.2.

## 11. Last issue being investigated
User asked why "Director rating for EA is not available". Prod check: Priyanka's 6 EA rating rows for September exist (all blank); her score is Pending only for "director ratings (0 of 6 KRA parameters rated)" (the EA needs no DPR/audit). Told to use Director Ratings > Priyanka Dalapati and enter the 6 ratings; asked whether the EA formula should be 100% director rating. If her name does not show in the dropdown on their screen, the cause is not yet known (possibly an older deployed build or a stale page).
