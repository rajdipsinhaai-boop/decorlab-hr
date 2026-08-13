import { TrendingUp, AlertTriangle, Users, Gauge } from "lucide-react";
import type { Employee } from "@/lib/hr-types";

function Stat({
  label,
  value,
  sub,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  tone?: "default" | "green" | "yellow" | "red";
}) {
  const toneClass =
    tone === "green"
      ? "text-success"
      : tone === "yellow"
        ? "text-warning"
        : tone === "red"
          ? "text-danger"
          : "text-primary";
  return (
    <div className="panel group p-4 transition-transform duration-300 hover:-translate-y-0.5 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        {icon ? <span className={toneClass}>{icon}</span> : null}
      </div>
      <p className={`mt-2 text-2xl font-semibold tabular-nums sm:text-3xl ${toneClass}`}>{value}</p>
      {sub ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function SummaryStrip({ employees }: { employees: Employee[] }) {
  const total = employees.length;
  const avg = total ? employees.reduce((a, e) => a + e.score, 0) / total : 0;
  const green = employees.filter((e) => e.rag === "GREEN").length;
  const yellow = employees.filter((e) => e.rag === "YELLOW").length;
  const red = employees.filter((e) => e.rag === "RED").length;
  const sorted = [...employees].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
      <Stat label="Employees" value={String(total)} icon={<Users className="h-4 w-4" />} />
      <Stat label="Average score" value={`${avg.toFixed(1)}%`} icon={<Gauge className="h-4 w-4" />} />
      <Stat label="Green ≥ 75%" value={String(green)} tone="green" />
      <Stat label="Yellow 60-75%" value={String(yellow)} tone="yellow" />
      <Stat label="Red < 60%" value={String(red)} tone="red" />
      <div className="panel col-span-2 p-4 sm:p-5 lg:col-span-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Callouts</p>
        <div className="mt-2 space-y-2 text-xs">
          <p className="flex items-start gap-2 text-success">
            <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="text-foreground">
              Top: <strong>{top?.name ?? "—"}</strong> {top ? `${top.score}%` : ""}
            </span>
          </p>
          <p className="flex items-start gap-2 text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="text-foreground">
              Watch: <strong>{bottom?.name ?? "—"}</strong> {bottom ? `${bottom.score}%` : ""}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}