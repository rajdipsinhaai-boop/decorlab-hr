import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeName } from "./attendance/normalize";
import { parseAudit } from "./audit-ingest";
import { computeMonthSafely } from "./scoring/compute.server";

const db = () => supabaseAdmin as any;

/**
 * A Claude "monthly-kra-audit" payload supplies the DPR, coordination and activity evidence. The
 * scores themselves are computed by the backend, so after the payload is read the month is
 * recomputed. Failing here must never reject the ingest: the raw payload is already saved.
 */
export async function applyAuditPayload(payload: unknown): Promise<{
  monthKey: string | null;
  matched: number;
  skipped: { name: string; reason: string }[];
  computed: unknown;
}> {
  const [emp, ali] = await Promise.all([
    db().from("employees").select("id, name"),
    db().from("employee_aliases").select("alias_key, employee_id"),
  ]);
  for (const r of [emp, ali]) if (r.error) throw new Error(r.error.message);

  const parsed = parseAudit(
    payload,
    (emp.data ?? []).map((e: any) => ({ employeeId: e.id, name: e.name })),
    new Map((ali.data ?? []).map((a: any) => [normalizeName(a.alias_key), a.employee_id])),
  );
  const computed = parsed.monthKey && parsed.people.size ? await computeMonthSafely(parsed.monthKey) : null;
  return { monthKey: parsed.monthKey, matched: parsed.people.size, skipped: parsed.skipped, computed };
}
