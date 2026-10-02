import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  FileWarning,
  Info,
  ShieldAlert,
  Users,
} from "lucide-react";
import { initialsOf, ragLabel, ragOf, type Rag } from "@/lib/hr-types";
import { JsonTree, isRecord } from "./JsonTree";

type Rec = Record<string, unknown>;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const list = (v: unknown): unknown[] =>
  Array.isArray(v) ? v : v == null || v === "" ? [] : [v];
const round = (n: number) => Math.round(n * 10) / 10;

const RAG_STYLE: Record<Rag, { text: string; bg: string; bar: string }> = {
  GREEN: { text: "text-success", bg: "bg-success/15", bar: "bg-success" },
  YELLOW: { text: "text-warning", bg: "bg-warning/15", bar: "bg-warning" },
  RED: { text: "text-danger", bg: "bg-danger/15", bar: "bg-danger" },
};
const STATUS_STYLE: Record<string, string> = {
  complete: "bg-success/15 text-success",
  partial: "bg-warning/15 text-warning",
  blocked: "bg-danger/15 text-danger",
};
const GROUP_LABEL: Record<string, string> = {
  supervisor: "Site supervisors",
  designer: "Interior designers",
  ea: "Executive assistant",
};

const METRICS: Record<string, { label: string; pct?: boolean }> = {
  dpr_quality: { label: "DPR quality", pct: true },
  coverage_pct: { label: "Filing coverage", pct: true },
  dpr_filing_days: { label: "Distinct filing days" },
  dpr_filings_raw: { label: "Raw filings" },
  working_days: { label: "Working days" },
  vendor_orders: { label: "Vendor orders sent" },
  coordination_pct: { label: "Task closure", pct: true },
  tasks_done: { label: "Tasks done" },
  tasks_total: { label: "Tasks total" },
  present_days: { label: "Present days (attendance)" },
  discipline_pct: { label: "DPR filing discipline", pct: true },
  raw_attendance_score: { label: "Raw attendance score", pct: true },
  adjusted_attendance_score: { label: "Adjusted attendance score", pct: true },
};
const BAR_KEYS = ["dpr_quality", "coverage_pct", "coordination_pct", "discipline_pct"];
const metricLabel = (k: string) =>
  METRICS[k]?.label ?? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const isPct = (k: string) => METRICS[k]?.pct ?? k.endsWith("_pct");
const asRag = (v: unknown): Rag | null => {
  const s = str(v).toUpperCase();
  return s === "GREEN" || s === "YELLOW" || s === "RED" ? s : null;
};

function Pill({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}
    >
      {children}
    </span>
  );
}

function RagPill({ score, rag }: { score: number | null; rag: unknown }) {
  const r = asRag(rag) ?? (score != null ? ragOf(score) : null);
  if (score == null && !r) return <Pill className="bg-muted text-muted-foreground">Not scored</Pill>;
  const s = RAG_STYLE[r ?? "YELLOW"];
  return (
    <Pill className={`${s.bg} ${s.text}`}>
      {score != null ? `${round(score)}%` : "—"}
      {r ? ` · ${ragLabel(r)}` : ""}
    </Pill>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  const rag = ragOf(value);
  return (
    <div className="min-w-[92px]">
      <div className="flex justify-between gap-2 text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{round(value)}%</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${RAG_STYLE[rag].bar}`}
          style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

function Notes({
  icon,
  title,
  items,
  tone,
  open,
}: {
  icon: ReactNode;
  title: string;
  items: unknown[];
  tone: string;
  open?: boolean;
}) {
  if (!items.length) return null;
  return (
    <details open={open} className={`rounded-lg border ${tone} p-3 text-xs`}>
      <summary className="flex cursor-pointer select-none items-center gap-2 font-medium">
        {icon} {title} <span className="text-muted-foreground">({items.length})</span>
      </summary>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 leading-relaxed text-foreground/90">
        {items.map((it, i) => (
          <li key={i} className="break-words">
            {isRecord(it) ? JSON.stringify(it) : str(it)}
          </li>
        ))}
      </ul>
    </details>
  );
}

const gradeStyle = (score: number | null) =>
  score == null
    ? "bg-muted text-muted-foreground"
    : score >= 100
      ? "bg-success/25 text-success"
      : score >= 75
        ? "bg-success/12 text-success"
        : score >= 50
          ? "bg-warning/20 text-warning"
          : "bg-danger/20 text-danger";

/** Per-supervisor DPR record (graded days, recurring issues) when the payload includes it. */
function DprDetail({ dpr }: { dpr: Rec }) {
  const days = list(dpr["days"]).filter(isRecord);
  const skip = new Set(["days", "recurring_issues"]);
  const rest = Object.entries(dpr).filter(([k]) => !skip.has(k));
  const scalars = rest.filter(([, v]) => typeof v !== "object" || v === null);
  const nested = rest.filter(([, v]) => typeof v === "object" && v !== null);
  return (
    <div className="space-y-3">
      {scalars.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {scalars.map(([k, v]) => (
            <div key={k} className="rounded-md bg-muted/40 px-2.5 py-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {metricLabel(k)}
              </div>
              <div className="text-sm font-medium tabular-nums">{v == null ? "—" : str(v)}</div>
            </div>
          ))}
        </div>
      ) : null}
      {days.length ? (
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            Graded days ({days.length})
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {days.map((d, i) => {
              const s = num(d["score"]);
              return (
                <div key={i} className={`rounded-md px-2.5 py-1.5 text-xs ${gradeStyle(s)}`}>
                  <div className="flex items-center justify-between gap-2 font-medium">
                    <span className="tabular-nums">{str(d["date"])}</span>
                    <span>
                      {str(d["grade"])}
                      {s != null ? ` · ${s}` : ""}
                    </span>
                  </div>
                  {d["project"] ? <div className="opacity-80">{str(d["project"])}</div> : null}
                  {d["note"] ? <div className="mt-0.5 text-foreground/80">{str(d["note"])}</div> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      <Notes
        icon={<Info className="h-3.5 w-3.5" />}
        title="Recurring issues"
        items={list(dpr["recurring_issues"])}
        tone="border-border"
      />
      {nested.map(([k, v]) =>
        Array.isArray(v) && v.every((x) => typeof x === "string") ? (
          <div key={k} className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">{metricLabel(k)}:</span>
            {v.map((x, i) => (
              <Pill key={i} className="bg-muted text-foreground">
                {String(x)}
              </Pill>
            ))}
          </div>
        ) : (
          <JsonTree key={k} label={k} value={v} />
        ),
      )}
    </div>
  );
}

function PersonRow({ p }: { p: Rec }) {
  const name = str(p["name"]) || "Unnamed";
  const score = num(p["final_score"]);
  const metrics = isRecord(p["metrics"]) ? p["metrics"] : {};
  const projects = list(p["projects"]).map(str).filter(Boolean);
  const flags = list(p["flags"]);
  const notMeasured = list(p["not_measured"]);
  const ratings = isRecord(metrics["manager_ratings"]) ? metrics["manager_ratings"] : {};
  const dpr = isRecord(p["dpr"]) ? p["dpr"] : null;
  const known = new Set([
    "name",
    "group",
    "final_score",
    "rag",
    "metrics",
    "projects",
    "flags",
    "not_measured",
    "dpr",
  ]);
  const extra = Object.entries(p).filter(([k]) => !known.has(k));
  const bars = BAR_KEYS.map((k) => [k, num(metrics[k])] as const).filter(
    (b): b is readonly [string, number] => b[1] != null,
  );
  return (
    <details className="rounded-lg border border-border/70 bg-card/40">
      <summary className="flex cursor-pointer select-none flex-wrap items-center gap-3 p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
          {initialsOf(name)}
        </span>
        <span className="min-w-[140px] flex-1">
          <span className="block text-sm font-medium">{name}</span>
          <span className="block text-[11px] text-muted-foreground">
            {projects.join(" · ") || "No project data"}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-3">
          {bars.map(([k, v]) => (
            <Bar key={k} label={metricLabel(k)} value={v} />
          ))}
          {flags.length ? (
            <Pill className="bg-warning/15 text-warning">
              <AlertTriangle className="h-3 w-3" />
              {flags.length}
            </Pill>
          ) : null}
          <RagPill score={score} rag={p["rag"]} />
        </span>
      </summary>
      <div className="space-y-3 border-t border-border/70 p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {Object.entries(metrics)
            .filter(([k]) => k !== "manager_ratings")
            .map(([k, v]) => (
              <div key={k} className="rounded-md bg-muted/40 px-2.5 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {metricLabel(k)}
                </div>
                {v == null ? (
                  <div className="text-xs italic text-muted-foreground">not measured</div>
                ) : (
                  <div className="text-sm font-medium tabular-nums">
                    {typeof v === "number" ? `${round(v)}${isPct(k) ? "%" : ""}` : str(v)}
                  </div>
                )}
              </div>
            ))}
        </div>
        {Object.keys(ratings).length ? (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Manager ratings (1–5)
            </div>
            <div className="grid gap-1 sm:grid-cols-2">
              {Object.entries(ratings).map(([k, v]) => (
                <div key={k} className="flex justify-between rounded bg-muted/40 px-2.5 py-1 text-xs">
                  <span>{k}</span>
                  <span className="tabular-nums">{str(v)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <Notes
          open
          icon={<ShieldAlert className="h-3.5 w-3.5 text-warning" />}
          title="Flags"
          items={flags}
          tone="border-warning/40"
        />
        <Notes
          icon={<CircleSlash className="h-3.5 w-3.5" />}
          title="Not measured"
          items={notMeasured}
          tone="border-border"
        />
        {dpr ? <DprDetail dpr={dpr} /> : null}
        {extra.map(([k, v]) => (
          <JsonTree key={k} label={k} value={v} />
        ))}
      </div>
    </details>
  );
}

export function AuditReport({ payload }: { payload: Rec }) {
  const status = str(payload["status"]).toLowerCase();
  const company = isRecord(payload["company"]) ? payload["company"] : {};
  const rag = isRecord(company["rag"]) ? company["rag"] : {};
  const avg = num(company["average_score"]);
  const sheet = isRecord(payload["sheet"]) ? payload["sheet"] : null;
  const people = list(payload["people"]).filter(isRecord);
  const top3 = list(payload["top3"]).filter(isRecord);
  const coverage = isRecord(payload["coverage"]) ? payload["coverage"] : null;
  const counts = (["GREEN", "YELLOW", "RED"] as const).map(
    (k) => [k, num(rag[k.toLowerCase()]) ?? 0] as const,
  );
  const total = counts.reduce((a, [, n]) => a + n, 0);
  const groups = [...new Set(people.map((p) => str(p["group"]) || "other"))];
  const knownTop = new Set([
    "report",
    "status",
    "mode",
    "review_month",
    "generated_at",
    "sheet",
    "company",
    "top3",
    "people",
    "coverage",
    "roster_gaps",
    "alerts",
    "limitations",
    "blockers",
  ]);
  const extra = Object.entries(payload).filter(([k]) => !knownTop.has(k));
  const scanned = coverage ? num(coverage["projects_scanned"]) : null;
  const totalProjects = coverage ? num(coverage["projects_total"]) : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-base font-semibold tracking-tight">
          Monthly KRA audit · {str(payload["review_month"]) || "month unknown"}
        </h4>
        <Pill className={STATUS_STYLE[status] ?? "bg-muted text-muted-foreground"}>
          {status === "complete" ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : status ? (
            <FileWarning className="h-3 w-3" />
          ) : null}
          {status || "no status"}
        </Pill>
        {payload["mode"] ? <Pill className="bg-primary/15 text-primary">{str(payload["mode"])}</Pill> : null}
        {sheet ? (
          <Pill
            className={sheet["written"] ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}
          >
            {sheet["written"] ? `Sheet written: ${str(sheet["title"])}` : "Sheet not written"}
          </Pill>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border/70 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Company average
          </div>
          <div
            className={`text-3xl font-semibold tabular-nums ${avg != null ? RAG_STYLE[ragOf(avg)].text : ""}`}
          >
            {avg != null ? `${round(avg)}%` : "—"}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {num(company["scored_people"]) ?? "?"} scored · {num(company["unscored_people"]) ?? 0} not
            scored
          </div>
        </div>
        <div className="rounded-lg border border-border/70 p-3 sm:col-span-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            RAG distribution
          </div>
          <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-muted">
            {total > 0
              ? counts.map(([k, n]) =>
                  n > 0 ? (
                    <div
                      key={k}
                      className={RAG_STYLE[k].bar}
                      style={{ width: `${(n / total) * 100}%` }}
                      title={`${ragLabel(k)}: ${n}`}
                    />
                  ) : null,
                )
              : null}
          </div>
          <div className="mt-2 flex gap-4 text-xs">
            {counts.map(([k, n]) => (
              <span key={k} className={RAG_STYLE[k].text}>
                {ragLabel(k)} {n}
              </span>
            ))}
          </div>
          {company["score_basis"] ? (
            <p className="mt-2 text-[11px] italic leading-relaxed text-muted-foreground">
              Basis: {str(company["score_basis"])}
            </p>
          ) : null}
        </div>
      </div>

      {top3.length ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Top 3:</span>
          {top3.map((t, i) => (
            <Pill key={i} className="bg-primary/15 text-primary">
              #{i + 1} {str(t["name"])} · {str(t["score"])}
            </Pill>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        <Notes
          open={status !== "complete"}
          icon={<ShieldAlert className="h-3.5 w-3.5 text-danger" />}
          title="Blockers"
          items={list(payload["blockers"])}
          tone="border-danger/40"
        />
        <Notes
          open
          icon={<AlertTriangle className="h-3.5 w-3.5 text-warning" />}
          title="Alerts"
          items={list(payload["alerts"])}
          tone="border-warning/40"
        />
        <Notes
          icon={<Users className="h-3.5 w-3.5" />}
          title="Roster gaps — decision needed"
          items={list(payload["roster_gaps"])}
          tone="border-primary/40"
        />
        <Notes
          icon={<Info className="h-3.5 w-3.5" />}
          title="Limitations"
          items={list(payload["limitations"])}
          tone="border-border"
        />
      </div>

      {coverage ? (
        <div className="rounded-lg border border-border/70 p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            Data coverage
          </div>
          {totalProjects ? (
            <Bar
              label={`Projects scanned ${scanned ?? 0} / ${totalProjects}`}
              value={((scanned ?? 0) / totalProjects) * 100}
            />
          ) : null}
          <div className="mt-2 space-y-1">
            {Object.entries(coverage)
              .filter(([k]) => k !== "projects_total" && k !== "projects_scanned")
              .map(([k, v]) => (
                <JsonTree key={k} label={k} value={v} depth={1} />
              ))}
          </div>
        </div>
      ) : null}

      {groups.map((g) => {
        const members = people.filter((p) => (str(p["group"]) || "other") === g);
        return (
          <section key={g} className="space-y-2">
            <h5 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {GROUP_LABEL[g] ?? g} ({members.length})
            </h5>
            {members.map((p, i) => (
              <PersonRow key={`${str(p["name"])}-${i}`} p={p} />
            ))}
          </section>
        );
      })}

      {extra.length ? (
        <div className="rounded-lg border border-border/70 p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Other fields in this payload
          </div>
          {extra.map(([k, v]) => (
            <JsonTree key={k} label={k} value={v} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
