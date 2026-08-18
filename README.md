# Decorlab Pulse

I’m building an internal HR performance dashboard for my interior design/construction firm, Decorlab. It reads live data from a Google Sheet and displays it visually for our 11 employees (site supervisors, interior designers, and an EA). This is sensitive HR data (attendance, performance scores, manager feedback) — it must never be publicly readable, so do not use the “publish to web as CSV” trick. Instead:

1. Backend / data access

Set up a Google Sheets read (and limited write) connection through a secure backend function (Supabase edge function via Lovable Cloud), not exposed to the browser. Use a Google service account with domain-restricted access; store its credentials as a server-side secret. The frontend calls our own backend endpoint, which in turn calls the Google Sheets API — the service account key must never reach client-side JS.

The spreadsheet ID is: <<11gz8_k0o12efp-Mh2rhQZGCOl0ZcksgEDpo0QpqLNCs>>

The sheet has these tabs (all should be fetched read-only except Control):

	•	Employee Master — employee ID, name, role, join date

	•	Supervisor KRA — for site supervisors: Attendance Score (30%), DPR Combined Score (50%), System Work Feedback (20%), and a computed Final Score / RAG status per employee

	•	Designer KRA — for interior designers: Attendance Score (25%), Coordination Score (40%), System Work Feedback (35%), individual rated criteria (Design Quality & Creativity, Client Satisfaction & Feedback, Timeline & Deadline Adherence, Revision Efficiency / Rework Ratio, Technical/Drawing Accuracy, Site Problem-Solving Skills), and computed Final Score / RAG

	•	EA KRA — Attendance Score (60%), System Work Feedback (40%), Final Score / RAG

	•	Monthly Summary — one row per employee, rolled-up final score, RAG status, role

	•	Daily Attendance — one row per employee per working day: date, day of week, employee ID/name/role, status (Present/Absent/Week Off), in-time, out-time, hours worked

	•	Raw Data — underlying attendance aggregates (present/absent days, average hours, punctuality deviation minutes, etc.) feeding the Attendance Score

	•	Control — this is the ONLY tab the frontend writes to. Columns: Request ID, Requested At (UTC), Requested By, Month, Status (dropdown: PENDING / PROCESSING / DONE / FAILED), Drive Folder Link, Completed At (UTC)

2. What the dashboard should show

Build a single-page, dark-and-gold themed (navy #0B1F3A background, gold #C9A227 accents — matches our report card branding) interactive dashboard with:

	•	A top summary strip: total employees, average score, count in RED / YELLOW / GREEN RAG buckets, most-improved / needs-attention callouts.

	•	A grid of employee cards, one per person, each showing: name, role, photo initials avatar, big RAG-colored score ring (0-100%), and a one-line status label (e.g. “Strong — 82%”, “Needs Attention — 54%”). Clicking a card expands/opens a detail view.

	•	Employee detail view: horizontal stacked bar showing the weighted score breakdown (e.g. Attendance / Coordination / System Work Feedback segments, colored and labeled with their % weight and contribution), a small radar or bar chart of the individual rated KRA criteria (1-5 scale) for designers, and an attendance calendar heatmap for the selected month (green = present, red = absent, grey = week off) built from the Daily Attendance tab.

	•	An attendance & punctuality section: a chart comparing in-time vs. scheduled time (punctuality deviation in minutes) per employee, and average hours worked vs. target, so late-arrival patterns are visually obvious at a glance.

	•	A company-wide trend section if multiple months of data exist later (design it to be ready for that even though right now there’s only July 2026 data — don’t hardcode “July” anywhere in the data layer, read the month from the sheet).

	•	RAG legend clearly explained: RED < 60%, YELLOW 60-75%, GREEN ≥ 75%.

	•	Smooth transitions, hover states, and a genuinely polished, modern look — this should feel like a premium analytics product, not a spreadsheet clone. Use a charting library (Recharts is fine) for all charts; avoid plain HTML tables except as a fallback/export view.

	•	Make it fully responsive — I’ll be checking this from my phone as often as from a laptop.

3. The “Create Report” button

Add a prominent “Create Report” button (top right, gold, always visible). When clicked:

	•	Open a small confirm dialog showing which month’s data is about to be turned into report cards, with a final “Yes, generate” confirmation.

	•	On confirm, the backend function appends a new row to the Control tab: a generated Request ID (uuid), current UTC timestamp, the logged-in user’s name/email, the target month, Status = PENDING, and empty Drive Folder Link / Completed At.

	•	Show a toast confirming the request was queued, and switch the button into a “Processing…” state.

	•	Poll the Control tab every ~15-20 seconds for that Request ID’s row; when Status flips to DONE, show a success toast with a “View in Drive” link (from the Drive Folder Link column) and reset the button. If it flips to FAILED, show an error toast.

Note: the actual PDF generation happens outside this app — a separate automation watches the Control tab and does the work. Your job is only to write the PENDING row and reflect status changes; you don’t need to generate PDFs yourself.

4. Auth

Simple email/password login (Lovable Cloud auth) restricted to a short allow-list of email addresses I’ll provide (me and anyone else on the leadership team who should see this) — nobody else should be able to sign up.

Build this now, starting with the Sheets connection and the employee card grid, then layer in the detail view, attendance charts, and the Create Report flow.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://decorlab-hr.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/3b834ccc-70bb-4477-a3d2-652f53bb15f5).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
