import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardData } from "@/lib/hr-types";

export function TrendSection({ data }: { data: DashboardData }) {
  // One point per month that has been scored, computed server-side from each month's own scores.
  const points = data.trend;

  return (
    <section className="panel p-4 sm:p-5">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Company-wide trend</h3>
          <p className="text-xs text-muted-foreground">Average final KRA score per review month</p>
        </div>
        {points.length < 2 ? (
          <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
            More months appear here automatically
          </span>
        ) : null}
      </header>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 16, bottom: 8, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="month" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <YAxis domain={[0, 100]} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                color: "var(--popover-foreground)",
                fontSize: 12,
              }}
              formatter={(v: number) => [`${v}%`, "Average"]}
            />
            <Line
              type="monotone"
              dataKey="average"
              stroke="var(--primary)"
              strokeWidth={2.5}
              dot={{ r: 5, fill: "var(--primary)" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}