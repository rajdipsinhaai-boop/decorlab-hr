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
  score: number;
  rag: Rag;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ragColor[rag]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          className="transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold tabular-nums" style={{ color: ragColor[rag] }}>
          {Math.round(pct)}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">score</span>
      </div>
    </div>
  );
}