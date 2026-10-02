import type { Employee, ScoreCardModel } from "../hr-types";
import { bandText } from "../scoring/constants";

/**
 * The old hand-written narratives were stored one wrapped line at a time. A line that starts with
 * "-" or ">" begins a new bullet; any other line continues the previous one.
 */
export function mergeBullets(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[-•>]\s/.test(line) || out.length === 0) out.push(line.replace(/^[-•>]\s*/, ""));
    else out[out.length - 1] += ` ${line}`;
  }
  return out;
}

/**
 * The card to show or print for one employee. Months scored by the backend carry their full card;
 * months from the old spreadsheet are rebuilt from the stored breakdown, ratings and narrative.
 */
export function modelFor(employee: Employee, month: string): ScoreCardModel {
  if (employee.card) return employee.card;
  const report = employee.reportCard;
  return {
    version: 1,
    name: employee.name,
    role: employee.role,
    roleGroup: employee.roleGroup,
    month,
    finalScore: employee.score,
    rag: employee.rag,
    pending: employee.score === null ? ["this month's scores"] : [],
    bandText: bandText(employee.rag),
    components: employee.breakdown.map((b) => ({
      label: b.label,
      weight: b.weight,
      score: b.score,
      note: b.note ?? "",
    })),
    kra: employee.criteria.map((c) => ({
      name: c.name,
      rating: c.rated === false ? null : c.rating,
    })),
    why: report ? mergeBullets(report.whyScore) : [],
    improve: report ? mergeBullets(report.improveNextMonth) : [],
    generatedAt: new Date().toISOString(),
  };
}
