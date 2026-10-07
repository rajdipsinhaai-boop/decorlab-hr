import { bandText, ROLE_LABEL } from "./constants";
import { buildNarrative } from "./narrative";
import type { AuditPerson, RatingIn, RoleGroup, ScoreCardModel, ScoreResult } from "./types";

/** One model drives both the dashboard panel and the PDF, so they can never disagree. */
export function buildScoreCard(args: {
  name: string;
  role?: string;
  roleGroup: RoleGroup;
  month: string;
  result: ScoreResult;
  ratings: RatingIn[];
  audit: AuditPerson | null;
  probationEnds?: string;
  now?: Date;
}): ScoreCardModel {
  const { result } = args;
  const narrative = buildNarrative(args.roleGroup, result, args.ratings, args.audit);
  return {
    version: 1,
    name: args.name,
    role: args.role || ROLE_LABEL[args.roleGroup],
    roleGroup: args.roleGroup,
    month: args.month,
    finalScore: result.final,
    rag: result.rag,
    pending: result.missing,
    bandText: bandText(result.rag),
    components: result.components.map((c) => ({
      label: c.label,
      weight: c.weight,
      score: c.score,
      note: c.note,
    })),
    kra: args.ratings.map((r) => ({ name: r.name, rating: r.rating })),
    why: narrative.why,
    improve: narrative.improve,
    ...(args.probationEnds ? { probationEnds: args.probationEnds } : {}),
    generatedAt: (args.now ?? new Date()).toISOString(),
  };
}
