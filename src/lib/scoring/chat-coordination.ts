import type { AuditPerson } from "./types";

/** One person's coordination rating from the WhatsApp-chat review (1 to 5 per criterion). */
export interface ChatCoordination {
  employee_id: string;
  overall: number; // 1-5, plain average of the criteria
  evidence: string; // High | Medium | Low
  comment: string;
  period: string; // e.g. "September 2026"
}

const emptyAudit = (): AuditPerson => ({
  dprDays: [],
  dprFilingDays: null,
  coveragePct: null,
  dprQuality: null,
  coordinationPct: null,
  coordinationBasis: "",
  activityDays: null,
  vendorOrders: null,
  flags: [],
  comments: { why: [], improve: [] },
});

/**
 * For designers, the chat-based coordination rating becomes their Coordination score (overall / 5 x 100).
 * It replaces whatever the Rdash task audit said, and fills in a designer the audit had nothing for.
 * Only roles in `designerIds` are touched.
 */
export function applyChatCoordination(
  people: Map<string, AuditPerson>,
  rows: ChatCoordination[],
  designerIds: Set<string>,
): void {
  for (const r of rows) {
    if (!designerIds.has(r.employee_id)) continue;
    const person = people.get(r.employee_id) ?? emptyAudit();
    person.coordinationPct = Math.round(Number(r.overall) * 20 * 10) / 10;
    person.coordinationBasis =
      `Chat coordination review of the WhatsApp groups (${r.period}): ${Number(r.overall)}/5, evidence ${r.evidence}. ${r.comment}`.trim();
    people.set(r.employee_id, person);
  }
}
