# Decorlab HR Performance Dashboard

A private HR performance dashboard for Decorlab. The application reads live data from a protected Google Sheet, displays performance and attendance analytics, and writes only queued report requests to the `Control` tab. Sensitive HR data is never published as a public CSV or exposed to the browser through a direct Google credential.

## Architecture

The application is a standard TanStack Start and Nitro application deployed to Vercel. Supabase provides authentication and the native Google Sheets and Drive APIs provide server-side data access through a Google service account. The service-account credential is stored only in Vercel environment variables and is never committed to the repository or bundled into client-side JavaScript.

The live spreadsheet ID is `11gz8_k0o12efp-Mh2rhQZGCOl0ZcksgEDpo0QpqLNCs`.

The main tabs are `Employee Master`, `Supervisor KRA`, `Designer KRA`, `EA KRA`, `Monthly Summary`, `Daily Attendance`, `Raw Data`, and `Control`. All tabs are read-only to the dashboard except `Control`, which receives queued report requests with a request ID, UTC timestamp, requesting user, month, status, Drive folder link, and completion timestamp.

## Environment variables

Browser-safe Supabase variables use the `VITE_` prefix. All Google credentials and server-only Supabase variables must remain unprefixed.

```text
VITE_SUPABASE_PROJECT_ID=...
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
GOOGLE_SERVICE_ACCOUNT_JSON={...}
GOOGLE_SHEET_ID=11gz8_k0o12efp-Mh2rhQZGCOl0ZcksgEDpo0QpqLNCs
GOOGLE_DRIVE_ROOT_FOLDER_ID=...
CRON_SECRET=...
```

The optional read-only AI assistant uses `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL`. It is disabled gracefully when `OPENAI_API_KEY` is not configured.

## Dashboard behavior

The dashboard uses a dark navy and gold visual system, responsive employee cards, RAG-colored scores, weighted KRA breakdowns, attendance summaries, punctuality metrics, and charts. RAG bands are RED below 60%, YELLOW from 60% through 75%, and GREEN at or above 75%.

The `Create Report` flow appends a `PENDING` row to `Control`, polls the row for completion, and presents the resulting Drive folder link when an external automation changes the status to `DONE`. The dashboard does not generate PDFs itself.

## Local development

Use Node.js 20 or later and pnpm.

```sh
git clone <this-repository-url>
cd decorlab-hr
pnpm install
pnpm dev
```

Create a local `.env` from `.env.example` and keep the service-account JSON private. Run a production build with:

```sh
pnpm build
```

## Deployment

Push the repository’s `main` branch to GitHub. Vercel detects the standard TanStack Start/Nitro configuration and deploys the project using the Vercel Nitro preset. Add the required environment variables for Production, Preview, and Development in the Vercel project settings, then redeploy whenever a variable changes.
