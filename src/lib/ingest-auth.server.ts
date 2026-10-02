import { createHash, timingSafeEqual } from "node:crypto";

const sha = (v: string) => createHash("sha256").update(v).digest();
const same = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

// Claude's scheduled task sends: x-ingest-key: <RDASH_INGEST_KEY>
// ponytail: single shared secret, no rotation; move to per-client keys if more senders appear
export function ingestAuthorized(request: Request): boolean {
  const expected = process.env["RDASH_INGEST_KEY"];
  if (!expected) return false;
  return same(request.headers.get("x-ingest-key") ?? "", expected);
}
