# Monthly Claude audit: updated prompt and payload contract

The backend now **calculates the scores**. Claude's job is only to supply the evidence it alone can
read: the DPR reports (graded), the design coordination work, and which days each person left a
visible update. Do **not** compute final scores, attendance scores, discipline or ranks, and do
**not** send manager ratings. There is no Google Sheet or Drive step any more.

Replace `<APP_URL>` with the production address of this app (for example `https://decorlab-hr.vercel.app`;
your old prompt posted to `hr.decorlabs.co.in`, so use whichever domain serves this app).
The ingest key is read from the environment variable `DECORLAB_INGEST_KEY` (it must equal the app's
`RDASH_INGEST_KEY`). **Never type the key into the prompt.**

---

## Prompt (paste into the scheduled task)

Run the monthly Decorlab audit for the PREVIOUS full calendar month. Decorlab is a Kolkata interior-design firm.
The backend computes every score; you only collect and grade the evidence. Do not ask for confirmation.

Roster: Supervisors: Gouranga Panrui, Susovan Haldar, Sibhu Das, Arunava Mallick, Ranjan Maity, Subhajit Bhawal,
and Sukhendu Das if he is still on the roster (the backend ignores anyone not on its roster and reports them).
Designers: Bhavana Agarwal, Asif Ali Khan, Shibnath Mondal, Deep Das. EA: Priyanka Dalapati. The driver is excluded.

1. **DPR reports.** Pull every DPR report org-wide from Rdash (`list_dpr_reports`, paginate fully; do not trust the
   creator_id filter). Match people by normalised `created_by_name` (Rdash spells names inconsistently, e.g.
   "SUSHOVAN HALDAR" = Susovan Haldar, "Gouranga Parui" = Gouranga Panrui). Project-to-supervisor assignment is not
   fixed; rediscover it each run across all projects.
2. **One filing per day.** If someone filed more than once on the same day, treat the filings as cumulative and grade
   only the LAST filing of that day.
3. **Read and grade every day.** Read each graded day's DPR PDF in full (`report_file_url`): work log, blockers,
   tomorrow's plan, Material Update, images. Grade Excellent (100) / Good (75) / Partial (50) / Poor (25) on
   specificity, blocker handling and whether tomorrow's plan is filled. Do not penalise missing site photos or an empty
   Material Update (known org-wide gaps). **Set `blank: true` for a report that is essentially an empty template**
   (for example only a manpower count and "No update to show"); a blank report does not count as a visible update.
3a. **Vendor activity.** Count vendor orders per supervisor's projects for the month (`list_vendor_purchase_orders`).
   Activity count only; do not score it.
4. **Attendance.** Do not read any attendance file. The backend already holds it. Fetch it only if you need it for
   the summary: `GET <APP_URL>/api/public/attendance-summary?month=<Month YYYY>` with header
   `x-ingest-key: $DECORLAB_INGEST_KEY`.
5. **Designers.** From Rdash design_file Tasks (`list_task_views`, filter by assignee) for the month, compute for each
   designer `coordination_pct` = % of their revision/markup tasks marked done during the month, and a one-sentence
   `coordination_basis` (e.g. "8 of 8 revision comments closed, same-day to ~3 days"). If they had no such tasks, set
   `coordination_pct` to null and say so in `coordination_basis`. Also list `activity_days`: every date on which that
   designer (and the EA) did visible work in Rdash (task closed, design file uploaded or commented on, approval
   requested). Use an empty list if there was none, and omit the field if you could not check.
8. **Summary in this session:** who has no reports, blank-template patterns, designers with 0% closure, anything alarming.
9. **Send the result (do this LAST, also when partial).** Check that `DECORLAB_INGEST_KEY` is set (report only
   "present" or "missing"; if missing, do not post and say "ingest key missing"). Write the JSON below to
   `payload.json`, then:

   ```
   curl -sS -m 30 -w "\nHTTP %{http_code}\n" -X POST "<APP_URL>/api/public/rdash-ingest" \
     -H "x-ingest-key: $DECORLAB_INGEST_KEY" -H "content-type: application/json" -d @payload.json
   ```

   Success is HTTP 200 with `{"ok":true}` (the reply also says how many people matched and whether scores were
   recomputed). On any other result retry once after 30 seconds, then report the status and response text.

---

## Payload (body must stay under 256 KB; shorten notes, never drop days)

```json
{
  "report": "monthly-kra-audit",
  "status": "complete",
  "review_month": "September 2026",
  "generated_at": "2026-10-03T08:00:00Z",
  "people": [
    {
      "name": "Arunava Mallick",
      "group": "supervisor",
      "dpr": {
        "days": [
          { "date": "2026-09-02", "project": "Krishna Mansingka", "grade": "Poor", "score": 25, "blank": true,
            "note": "Only a manpower count; no work log or plan" }
        ]
      },
      "metrics": { "vendor_orders": 3 },
      "flags": ["tomorrow plan never filled"],
      "comments": {
        "why": ["Ten of the thirteen filed reports were blank templates."],
        "improve": ["Describe what was done, where, blockers and tomorrow's plan every day."]
      },
      "not_measured": []
    },
    {
      "name": "Bhavana Agarwal",
      "group": "designer",
      "metrics": { "coordination_pct": 100, "tasks_done": 8, "tasks_total": 8 },
      "coordination_basis": "8 of 8 revision comments closed, same-day to ~3 days",
      "activity_days": ["2026-09-01", "2026-09-02", "2026-09-04"],
      "flags": [],
      "comments": { "why": [], "improve": [] }
    }
  ],
  "limitations": [],
  "blockers": []
}
```

Field notes
- `dpr.days[].date` is `YYYY-MM-DD`; `grade` is Excellent/Good/Partial/Poor; `score` is 100/75/50/25.
- `blank` is what makes a day count as "no visible update" for the attendance penalty. If you omit it, the backend
  treats a note containing "No update to show" or "blank template" as blank.
- `comments` are optional, plain sentences about the DPR evidence only (the backend writes the attendance, discipline,
  coordination and rating comments itself).
- Do not send `final_score`, `rag`, `manager_ratings`, `present_days` or any attendance score. If you do send
  `final_score` it is only kept as a cross-check and is never used.
- Status values: `complete`, `partial` (something could not be done), `blocked` (nothing could be done). Put reasons
  in `blockers`.
