import { Hourglass } from "lucide-react";
import { fmtDay } from "@/lib/attendance/metrics";
import type { ScoreCardModel } from "@/lib/hr-types";

const tone = (score: number | null) =>
  score === null ? "text-muted-foreground" : score >= 75 ? "text-success" : score >= 60 ? "text-warning" : "text-danger";
const fill = (score: number | null) =>
  score === null ? "bg-muted" : score >= 75 ? "bg-success" : score >= 60 ? "bg-warning" : "bg-danger";

/** The same content as the printed report card: how the score was built, KRA ratings, comments. */
export function ScoreCardView({ card }: { card: ScoreCardModel }) {
  return (
    <div className="space-y-5">
      {card.probationEnds ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs font-medium text-foreground">
          On probation. Probation ends {fmtDay(card.probationEnds)}.
        </p>
      ) : null}
      {card.pending.length ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
          <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <p className="font-medium text-foreground">Score pending</p>
            <p className="mt-0.5 text-muted-foreground">Still waiting for: {card.pending.join("; ")}.</p>
          </div>
        </div>
      ) : null}

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          How this score was built
        </h4>
        {card.components.map((c) => (
          <div key={c.label} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-foreground">
                {c.label} <span className="text-xs font-normal text-muted-foreground">(weight {c.weight}%)</span>
              </p>
              <p className={`text-sm font-semibold tabular-nums ${tone(c.score)}`}>
                {c.score === null ? "Pending" : `${c.score}%`}
              </p>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div className={`h-full rounded-full ${fill(c.score)}`} style={{ width: `${c.score ?? 0}%` }} />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{c.note}</p>
          </div>
        ))}
      </section>

      {card.kra.length ? (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            System work feedback — KRA breakdown
          </h4>
          <div className="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
            {card.kra.map((k) => (
              <div key={k.name} className="flex items-center justify-between gap-3 border-b border-border/50 py-1 text-xs">
                <span className="text-foreground">{k.name}</span>
                {k.rating === null ? (
                  <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-primary">
                    NOT YET RATED
                  </span>
                ) : (
                  <span className="flex items-center gap-1" title={`${k.rating} / 5`}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <i
                        key={n}
                        className={`h-2 w-2 rounded-full ${n <= Math.round(k.rating!) ? "bg-foreground" : "bg-border"}`}
                      />
                    ))}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {card.why.length ? <Bullets title="Why this score" items={card.why} marker="–" /> : null}
      {card.improve.length ? <Bullets title="What to improve next month" items={card.improve} marker="›" /> : null}
    </div>
  );
}

function Bullets({ title, items, marker }: { title: string; items: string[]; marker: string }) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</h4>
      <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-primary">{marker}</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
