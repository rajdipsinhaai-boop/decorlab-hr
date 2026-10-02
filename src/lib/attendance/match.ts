import { levenshtein, normalizeName } from "./normalize";

export interface EmployeeRef {
  id: string;
  name: string;
  cosecId: string | null;
}

export interface MatchContext {
  employees: EmployeeRef[];
  /** normalised alias spelling -> employee id (e.g. "sushovan haldar" -> DLB-SUP-02) */
  aliases: Map<string, string>;
  /** biometric ids that must be ignored entirely (driver, etc.) -> reason */
  excluded: Map<string, string>;
}

export type Resolution =
  | {
      kind: "matched";
      employeeId: string;
      via: "cosec_id" | "name" | "alias";
      /** The employee had no biometric id on file yet; store this one for next time. */
      learnCosecId: boolean;
    }
  | { kind: "excluded"; reason: string }
  | {
      kind: "unmatched";
      reason: string;
      suggestions: { employeeId: string; name: string }[];
    };

/** Spelling distance that ignores word order: "Das Sibhu" ~ "Sibhu Das". */
function nameDistance(a: string, b: string): number {
  const sorted = (s: string) => s.split(" ").sort().join(" ");
  return Math.min(levenshtein(a, b), levenshtein(sorted(a), sorted(b)));
}

/**
 * Maps one biometric identity to an employee. Order: ignore list, biometric id, exact name,
 * known alias. Near-misses are only ever suggested, never linked automatically, because a wrong
 * link would credit one person's attendance to another.
 */
export function resolveIdentity(person: { cosecId: string; name: string }, ctx: MatchContext): Resolution {
  const excluded = ctx.excluded.get(person.cosecId);
  if (excluded !== undefined) return { kind: "excluded", reason: excluded };

  const byId = ctx.employees.find((e) => e.cosecId === person.cosecId);
  if (byId) return { kind: "matched", employeeId: byId.id, via: "cosec_id", learnCosecId: false };

  const key = normalizeName(person.name);
  const byName = ctx.employees.find((e) => normalizeName(e.name) === key);
  const aliasId = ctx.aliases.get(key);
  const byAlias = aliasId ? ctx.employees.find((e) => e.id === aliasId) : undefined;
  const hit = byName ?? byAlias;
  if (hit) {
    if (hit.cosecId && hit.cosecId !== person.cosecId) {
      return {
        kind: "unmatched",
        reason: `Name matches ${hit.name}, who is already linked to biometric id ${hit.cosecId}.`,
        suggestions: [{ employeeId: hit.id, name: hit.name }],
      };
    }
    return { kind: "matched", employeeId: hit.id, via: byName ? "name" : "alias", learnCosecId: !hit.cosecId };
  }

  const near = ctx.employees
    .map((e) => ({ e, d: nameDistance(key, normalizeName(e.name)) }))
    .filter(({ d }) => d <= Math.max(2, Math.round(key.length * 0.25)))
    .sort((x, y) => x.d - y.d)
    .slice(0, 3)
    .map(({ e }) => ({ employeeId: e.id, name: e.name }));
  return { kind: "unmatched", reason: "Not on the employee roster.", suggestions: near };
}
