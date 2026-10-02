import type { Rag } from "@/lib/hr-types";

const ragColor: Record<Rag, string> = {
  GREEN: "var(--success)",
  YELLOW: "var(--warning)",
  RED: "var(--danger)",
};

export function ScoreRing({
  score,
  rag,
  size = 104,
  stroke = 9,
}: {
  /** null = not scored yet: an empty ring with a dash. */
  score: number | null;
  rag: Rag | null;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score ?? 0));
  const color = rag ? ragColor[rag] : "var(--muted-foreground)";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          className="transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold tabular-nums" style={{ color }}>
          {score === null ? "—" : Math.round(pct)}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">score</span>
      </div>
    </div>
  );
}