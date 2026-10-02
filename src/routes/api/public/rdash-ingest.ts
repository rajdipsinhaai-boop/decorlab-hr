import { createFileRoute } from "@tanstack/react-router";
import { ingestAuthorized } from "@/lib/ingest-auth.server";

const MAX_BODY_BYTES = 256 * 1024;

async function handle(request: Request) {
  if (!ingestAuthorized(request)) return new Response("Unauthorized", { status: 401 });

  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES)
    return Response.json({ ok: false, error: "Body too large" }, { status: 413 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // table isn't in generated types until types.ts is regenerated
  const { data, error } = await (supabaseAdmin as any)
    .from("rdash_ingests")
    .insert({ source: "claude", payload })
    .select("id, received_at")
    .single();
  if (error) {
    console.error("rdash ingest failed:", error);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  // The payload is safely stored; recomputing the month's scores from it is best effort.
  let scores: unknown = null;
  try {
    const { applyAuditPayload } = await import("@/lib/audit-ingest.server");
    scores = await applyAuditPayload(payload);
  } catch (applyError) {
    console.error("rdash ingest: could not apply scores:", applyError);
    scores = { error: (applyError as Error).message };
  }
  return Response.json({ ok: true, received_from: "claude", ...data, scores });
}

export const Route = createFileRoute("/api/public/rdash-ingest")({
  server: { handlers: { POST: ({ request }) => handle(request) } },
});
