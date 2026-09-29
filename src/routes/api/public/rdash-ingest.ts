import { createHash, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";

const sha = (v: string) => createHash("sha256").update(v).digest();
const same = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

// Claude's scheduled task sends: x-claude-key: <public key>, Authorization: Bearer <private key>.
// The server stores only sha256("<public>:<private>") in RDASH_INGEST_HASH and compares in constant time.
function authorized(request: Request) {
  const expected = process.env["RDASH_INGEST_HASH"];
  if (!expected) return false;
  const pub = request.headers.get("x-claude-key") ?? "";
  const priv = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const got = createHash("sha256").update(`${pub}:${priv}`).digest("hex");
  return same(got, expected.trim().toLowerCase());
}

async function handle(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
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
