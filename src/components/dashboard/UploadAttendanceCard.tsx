import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getAttendanceJob,
  listAttendanceUploads,
  resolveAttendanceIdentity,
  uploadAttendance,
} from "@/lib/hr.functions";
import type { AttendanceUploadResult, ImportStats, PersonOutcome } from "@/lib/hr-types";
import { monthLabel } from "@/lib/attendance/normalize";
import { fileToBase64 } from "./month-options";

const MAX_BYTES = 20 * 1024 * 1024;
const POLL_MS = 3000;
const POLL_LIMIT = 100; // about five minutes

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function UploadAttendanceCard({
  roster,
  canResolve,
}: {
  roster: { id: string; name: string }[];
  /** Only administrators may decide who an unrecognised biometric id belongs to. */
  canResolve: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [result, setResult] = useState<AttendanceUploadResult | null>(null);
  const submit = useServerFn(uploadAttendance);
  const check = useServerFn(getAttendanceJob);
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const refreshData = () => {
    void queryClient.invalidateQueries({ queryKey: ["hr-dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["attendance-uploads"] });
  };

  const finish = (r: AttendanceUploadResult) => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setBusy(false);
    setResult(r);
    refreshData();
    if (r.status === "done" && r.stats) {
      toast.success(`Attendance imported for ${r.stats.monthKeys.map(monthLabel).join(", ")}`, {
        description: `${r.stats.rowsStored} daily records saved.`,
      });
    } else {
      toast.error("Attendance could not be imported", { description: r.error ?? "Unknown error" });
    }
  };

  const onPick = (f: File | null) => {
    if (f && !/\.(pdf|xlsx)$/i.test(f.name)) {
      toast.error("Upload the attendance report as a PDF or an Excel (.xlsx) file.");
      return;
    }
    if (f && f.size > MAX_BYTES) {
      toast.error("That file is larger than 20MB.");
      return;
    }
    setFile(f);
  };

  const onSubmit = async () => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    setPhase("Uploading and reading the report…");
    try {
      const r = await submit({ data: { filename: file.name, base64: await fileToBase64(file) } });
      setFile(null);
      if (r.status === "done" || r.status === "failed") return finish(r);

      // The import is still running in the background worker: wait for it.
      setPhase("Still processing in the background…");
      let polls = 0;
      timer.current = setInterval(async () => {
        try {
          const j = await check({ data: { jobId: r.jobId } });
          if (j && (j.status === "done" || j.status === "failed")) return finish(j);
          if (++polls >= POLL_LIMIT) {
            finish({ ...r, status: "failed", error: "Processing is taking longer than expected. Check the upload history shortly." });
          }
        } catch (err) {
          console.error(err);
        }
      }, POLL_MS);
    } catch (err) {
      setBusy(false);
      toast.error("Upload failed", { description: err instanceof Error ? err.message : "Unknown error" });
    }
  };

  return (
    <div className="panel flex h-full flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold tracking-tight">Upload Attendance</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Upload the monthly <em>Organization-Wise Attendance</em> report from the biometric system, as a PDF or an Excel
        file. The month is read from the report, every person is matched to the roster, and the records are saved straight
        to the database.
      </p>

      <div className="space-y-1.5">
        <Input
          type="file"
          accept="application/pdf,.pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          className="file:mr-3 file:rounded file:border-0 file:bg-primary/15 file:px-2 file:py-1 file:text-xs file:text-primary"
        />
      </div>

      <Button className="w-full sm:w-auto sm:self-start" disabled={!file || busy} onClick={onSubmit}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {busy ? phase || "Processing…" : "Upload attendance"}
      </Button>

      {result?.status === "failed" ? (
        <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p>{result.error ?? "The import failed."}</p>
        </div>
      ) : null}

      {result?.status === "done" && result.stats ? (
        <ImportSummary stats={result.stats} roster={roster} canResolve={canResolve} onResolved={refreshData} />
      ) : null}

      <RecentUploads />
    </div>
  );
}

function ImportSummary({
  stats,
  roster,
  canResolve,
  onResolved,
}: {
  stats: ImportStats;
  roster: { id: string; name: string }[];
  canResolve: boolean;
  onResolved: () => void;
}) {
  const matched = stats.people.filter((p) => p.outcome === "matched");
  const unmatched = stats.people.filter((p) => p.outcome === "unmatched");
  const excluded = stats.people.filter((p) => p.outcome === "excluded");
  return (
    <div className="space-y-3 rounded-md border border-success/30 bg-success/5 p-3 text-xs">
      <p className="flex items-center gap-2 font-medium">
        <CheckCircle2 className="h-4 w-4 text-success" />
        {stats.monthKeys.map(monthLabel).join(", ")} · {stats.rowsStored} daily records saved from{" "}
        {stats.format.toUpperCase()} ({stats.periodStart} to {stats.periodEnd})
      </p>
      <p className="text-muted-foreground">
        {matched.length} people matched to the roster
        {excluded.length ? ` · ${excluded.length} excluded (${excluded.map((p) => p.name).join(", ")})` : ""}
        {unmatched.length ? ` · ${unmatched.length} need a decision` : ""}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="py-1 pr-2 font-medium">Employee</th>
              <th className="px-2 font-medium">Present</th>
              <th className="px-2 font-medium">Hours</th>
              <th className="px-2 font-medium">Absent</th>
              <th className="px-2 font-medium">Leave</th>
              <th className="px-2 font-medium">Avg hrs</th>
            </tr>
          </thead>
          <tbody>
            {matched.map((p) => (
              <tr key={p.cosecId} className="border-t border-border/60">
                <td className="py-1 pr-2">
                  {p.employeeName} <span className="text-muted-foreground">({p.cosecId})</span>
                </td>
                <td className="px-2 tabular-nums">{p.summary?.presentDays}</td>
                <td className="px-2 tabular-nums">{p.summary?.totalHours}</td>
                <td className="px-2 tabular-nums">{p.summary?.absentDays}</td>
                <td className="px-2 tabular-nums">{p.summary?.leaveDays}</td>
                <td className="px-2 tabular-nums">{p.summary ? fmt(p.summary.avgHours) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unmatched.length ? (
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 text-warning" /> Not on the roster: their records are saved but not scored
          </p>
          {unmatched.map((p) => (
            <UnmatchedRow key={p.cosecId} person={p} roster={roster} canResolve={canResolve} onResolved={onResolved} />
          ))}
        </div>
      ) : null}

      {stats.warnings.length ? (
        <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
          {stats.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function UnmatchedRow({
  person,
  roster,
  canResolve,
  onResolved,
}: {
  person: PersonOutcome;
  roster: { id: string; name: string }[];
  canResolve: boolean;
  onResolved: () => void;
}) {
  const resolve = useServerFn(resolveAttendanceIdentity);
  const [employeeId, setEmployeeId] = useState(person.suggestions?.[0]?.employeeId ?? "");
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: "map" | "exclude") => {
    setBusy(true);
    try {
      const r = await resolve({
        data: { cosecId: person.cosecId, name: person.name, action, ...(action === "map" ? { employeeId } : {}) },
      });
      setDone(action === "map" ? `Linked · ${r.relinked} records attached` : "Excluded");
      onResolved();
    } catch (err) {
      toast.error("Could not save that decision", { description: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="min-w-[160px] font-medium">
        {person.name} <span className="font-normal text-muted-foreground">({person.cosecId}, {person.days} days)</span>
      </span>
      {done ? (
        <span className="text-success">{done}</span>
      ) : canResolve ? (
        <>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            aria-label={`Employee for ${person.name}`}
          >
            <option value="">Choose employee…</option>
            {roster.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={!employeeId || busy} onClick={() => run("map")}>
            Link
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run("exclude")}>
            Exclude
          </Button>
        </>
      ) : (
        <span className="text-muted-foreground">Ask an administrator to link or exclude this person.</span>
      )}
    </div>
  );
}

function RecentUploads() {
  const load = useServerFn(listAttendanceUploads);
  const { data } = useQuery({ queryKey: ["attendance-uploads"], queryFn: () => load(), staleTime: 30_000 });
  if (!data?.length) return null;
  return (
    <div className="mt-auto space-y-1 border-t border-border pt-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Recent uploads</p>
      {data.slice(0, 4).map((u) => (
        <p key={u.id} className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="text-foreground">{u.monthKeys.length ? u.monthKeys.map(monthLabel).join(", ") : u.filename}</span>
          <span>{u.format?.toUpperCase()}</span>
          <span className={u.status === "done" ? "text-success" : u.status === "failed" ? "text-danger" : "text-warning"}>
            {u.status}
          </span>
          <span>{new Date(u.createdAt).toLocaleDateString()}</span>
        </p>
      ))}
    </div>
  );
}
