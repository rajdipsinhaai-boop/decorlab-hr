import { createHash, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY_BYTES = 256 * 1024;
const sha = (v: string) => createHash("sha256").update(v).digest();
const same = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

// Claude's scheduled task sends: x-ingest-key: <RDASH_INGEST_KEY>
// ponytail: single shared secret, no rotation; move to per-client keys if more senders appear
function authorized(request: Request) {
  const expected = process.env["RDASH_INGEST_KEY"];
  if (!expected) return false;
  return same(request.headers.get("x-ingest-key") ?? "", expected);
}

async function handle(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

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
  return Response.json({ ok: true, received_from: "claude", ...data });
}

export const Route = createFileRoute("/api/public/rdash-ingest")({
  server: { handlers: { POST: ({ request }) => handle(request) } },
});
