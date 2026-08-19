import { useState } from "react";
import { Download, FileText } from "lucide-react";
import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ScoreRing } from "./ScoreRing";
import { AttendanceHeatmap } from "./AttendanceHeatmap";
import { ActivitySection } from "./ActivitySection";
import { initialsOf, ragLabel, type Employee } from "@/lib/hr-types";

const SEGMENT_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-4)"];

export function EmployeeDetail({
  employee,
  month,
  onOpenChange,
}: {
  employee: Employee | null;
  month: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(employee)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto border-border bg-card">
        {employee ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3 text-left">
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-primary/40 bg-secondary text-sm font-semibold text-primary">
                  {initialsOf(employee.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-lg font-semibold">{employee.name}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {employee.role} · {month}
                  </span>
                </span>
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-5">
              <ScoreRing score={employee.score} rag={employee.rag} />
              <div className="min-w-[180px] flex-1 space-y-1 text-sm">
                <p className="font-medium">
                  {ragLabel(employee.rag)} — {employee.score}%
                </p>
                <p className="text-xs text-muted-foreground">
                  Rank in role {employee.rankInRole ?? "—"} · Overall {employee.overallRank ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Avg {employee.avgHours}h/day · punctuality {employee.punctualityDeviation >= 0 ? "+" : ""}
                  {employee.punctualityDeviation} min
                </p>
                {employee.note ? <p className="text-xs text-muted-foreground">{employee.note}</p> : null}
              </div>
            </div>

            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Weighted score breakdown
              </h4>
              <div className="flex h-9 w-full overflow-hidden rounded-lg border border-border">
                {employee.breakdown.map((seg, i) => (
                  <div
                    key={seg.label}
                    title={`${seg.label}: ${seg.score}% × ${seg.weight}% = ${seg.contribution}`}
                    className="flex items-center justify-center text-[10px] font-semibold text-primary-foreground transition-all duration-500"
                    style={{
                      width: `${seg.weight}%`,
                      backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
                    }}
                  >
                    {seg.weight}%
                  </div>
                ))}
              </div>
              <ul className="grid gap-1.5 sm:grid-cols-3">
                {employee.breakdown.map((seg, i) => (
                  <li key={seg.label} className="flex items-start gap-2 text-xs">
                    <i
                      className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }}
                    />
                    <span>
                      <span className="block text-foreground">{seg.label}</span>
                      <span className="text-muted-foreground">
                        {seg.score}% × {seg.weight}% → {seg.contribution} pts
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {employee.reportCard ? (
              <section className="space-y-4 rounded-xl border border-primary/20 bg-secondary/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Detailed report card
                    </h4>
                  </div>
                  <ReportCardDownloadButton
                    path={employee.reportCard.downloadPath}
                    filename={`${employee.name} - ${employee.reportCard.month} Report Card.pdf`}
                  />
                </div>
                {employee.reportCard.scoreBuilt.length ? (
                  <NarrativeList title="How this score was built" items={employee.reportCard.scoreBuilt} />
                ) : null}
                {employee.reportCard.whyScore.length ? (
                  <NarrativeList title="Why this score" items={employee.reportCard.whyScore} />
                ) : null}
                {employee.reportCard.improveNextMonth.length ? (
                  <NarrativeList title="What to improve next month" items={employee.reportCard.improveNextMonth} />
                ) : null}
              </section>
            ) : null}

            {employee.criteria.length ? (
              <section className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Rated criteria (1-5)
                </h4>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={employee.criteria} outerRadius="72%">
                      <PolarGrid stroke="var(--border)" />
                      <PolarAngleAxis
                        dataKey="name"
                        tick={{ fill: "var(--muted-foreground)", fontSize: 9 }}
                      />
                      <Radar
                        dataKey="rating"
                        stroke="var(--primary)"
                        fill="var(--primary)"
                        fillOpacity={0.35}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--popover)",
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          color: "var(--popover-foreground)",
                          fontSize: 12,
                        }}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            ) : null}

            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Attendance calendar
              </h4>
              <AttendanceHeatmap days={employee.days} />
            </section>

            <ActivitySection employee={employee} month={month} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NarrativeList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-foreground">{title}</p>
      <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="flex gap-2">
            <span className="text-primary">•</span>
            <span>{item.replace(/^[-•>]\s*/, "")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReportCardDownloadButton({ path, filename }: { path: string; filename: string }) {
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Your session has expired. Please sign in again.");
      const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Report card could not be downloaded.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={download} disabled={downloading}>
      <Download className="mr-1.5 h-3.5 w-3.5" />
      {downloading ? "Preparing…" : "Download PDF"}
    </Button>
  );
}
