import { createFileRoute } from "@tanstack/react-router";

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handle(request: Request) {
  const secret = process.env["CRON_SECRET"];
  if (!secret) return new Response("Cron secret is not configured", { status: 500 });

  const url = new URL(request.url);
  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("key") ??
    "";
  if (!timingSafeEqual(provided, secret)) return new Response("Unauthorized", { status: 401 });

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