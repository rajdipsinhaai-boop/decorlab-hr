import { monthKeyOf, normalizeName } from "./attendance/normalize";
import type { AuditPerson } from "./scoring/types";

interface Person {
  employeeId: string;
  name: string;
}

export interface ParsedAudit {
  monthKey: string | null;
  /** The audit's own view of each matched person. */
  people: Map<string, AuditPerson>;
  /** People in the payload who could not be matched to the roster. */
  skipped: { name: string; reason: string }[];
  /** The audit's own final scores, kept only as a cross-check against the computed ones. */
  claudeScores: Map<string, number>;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] => list(v).map(str).filter(Boolean);

/** A report that says nothing ("No update to show") is a blank template, even if the audit forgot to flag it. */
const BLANK_NOTE = /no update to show|blank template|empty template|template only/i;

/**
 * Reads a "monthly-kra-audit" payload (what the Claude scheduled task posts). It supplies the
 * DPR days, coordination and activity evidence; the scores themselves are computed by the backend.
 * Matching is by normalised name against the roster and its known spellings.
 */
export function parseAudit(
  payload: unknown,
  roster: Person[],
  aliases: Map<string, string> = new Map(),
): ParsedAudit {
  const out: ParsedAudit = { monthKey: null, people: new Map(), skipped: [], claudeScores: new Map() };
  if (!isRec(payload) || payload["report"] !== "monthly-kra-audit") return out;
  out.monthKey = monthKeyOf(str(payload["review_month"]));
  if (!out.monthKey) return out;

  const byName = new Map(roster.map((p) => [normalizeName(p.name), p]));
  const byId = new Map(roster.map((p) => [p.employeeId, p]));

  for (const raw of list(payload["people"])) {
    if (!isRec(raw)) continue;
    const name = str(raw["name"]);
    const key = normalizeName(name);
    const person = byName.get(key) ?? (aliases.has(key) ? byId.get(aliases.get(key)!) : undefined);
    if (!person) {
      out.skipped.push({ name, reason: "not on the roster" });
      continue;
    }
    const metrics = isRec(raw["metrics"]) ? raw["metrics"] : {};
    const dpr = isRec(raw["dpr"]) ? raw["dpr"] : {};
    const comments = isRec(raw["comments"]) ? raw["comments"] : {};
    const activity = raw["activity_days"] ?? metrics["activity_days"];

    out.people.set(person.employeeId, {
      dprDays: list(dpr["days"])
        .filter(isRec)
        .map((d) => {
          const note = str(d["note"]);
          return {
            date: str(d["date"]),
            grade: str(d["grade"]),
            score: num(d["score"]),
            blank: typeof d["blank"] === "boolean" ? d["blank"] : BLANK_NOTE.test(note),
            project: str(d["project"]),
            note,
          };
        }),
      dprFilingDays: num(metrics["dpr_filing_days"]),
      coveragePct: num(metrics["coverage_pct"]),
      dprQuality: num(metrics["dpr_quality"]),
      coordinationPct: num(metrics["coordination_pct"]),
      coordinationBasis: str(raw["coordination_basis"]) || str(metrics["coordination_basis"]),
      activityDays: Array.isArray(activity) ? strings(activity) : null,
      vendorOrders: num(metrics["vendor_orders"]),
      flags: strings(raw["flags"]),
      comments: { why: strings(comments["why"]), improve: strings(comments["improve"]) },
    });
    const claude = num(raw["final_score"]);
    if (claude !== null) out.claudeScores.set(person.employeeId, claude);
  }
  return out;
}
