import { createFileRoute } from "@tanstack/react-router";

function matches(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handle(request: Request) {
  const expected = [
    process.env["SUPABASE_ANON_KEY"],
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"],
  ].filter((v): v is string => Boolean(v));

  const provided =
    request.headers.get("apikey") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!expected.some((key) => matches(provided, key))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { runScheduledPass } = await import("@/lib/cron/run.server");
  try {
    const result = await runScheduledPass();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("Scheduled pass failed:", error);
    return Response.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/cron/process-queue")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});