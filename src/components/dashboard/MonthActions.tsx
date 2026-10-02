import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Calculator, Loader2, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { finalizeMonth, recalculateMonth, reopenMonth } from "@/lib/hr.functions";

/** Admin controls for one month: recompute scores, lock them (and store the report cards), or reopen. */
export function MonthActions({ month, locked }: { month: string; locked: { at: string; by: string } | null }) {
  const recalc = useServerFn(recalculateMonth);
  const finalize = useServerFn(finalizeMonth);
  const reopen = useServerFn(reopenMonth);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"recalc" | "finalize" | "reopen" | null>(null);
  const [confirm, setConfirm] = useState<"finalize" | "reopen" | null>(null);
  const [pending, setPending] = useState<string[]>([]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["hr-dashboard"] });
  const fail = (title: string, err: unknown) =>
    toast.error(title, { description: err instanceof Error ? err.message : "Unknown error" });

  const onRecalc = async () => {
    setBusy("recalc");
    try {
      const r = await recalc({ data: { month } });
      if (r.skipped === "finalized") toast.info(`${month} is finalized, so its scores were not changed.`);
      else if (r.skipped === "legacy") toast.info(`${month} was scored in the old sheet and is kept as it was.`);
      else toast.success(`${month} recalculated`, { description: `${r.scored} scored, ${r.pending} still pending.` });
      refresh();
    } catch (e) {
      fail("Could not recalculate", e);
    } finally {
      setBusy(null);
    }
  };

  const runFinalize = async (force: boolean) => {
    setConfirm(null);
    setBusy("finalize");
    try {
      const r = await finalize({ data: { month, force } });
      if (r.pending.length) {
        setPending(r.pending);
        return;
      }
      toast.success(`${month} finalized`, {
        description: "Scores, zones, ranks and notes are frozen, and every report card is stored.",
      });
      refresh();
    } catch (e) {
      fail("Could not finalize", e);
    } finally {
      setBusy(null);
    }
  };

  const runReopen = async () => {
    setConfirm(null);
    setBusy("reopen");
    try {
      await reopen({ data: { month } });
      toast.success(`${month} reopened`, { description: "Scores can be recalculated again." });
      refresh();
    } catch (e) {
      fail("Could not reopen", e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {locked ? (
        <>
          <span
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-3 text-xs font-medium text-success"
            title={`Finalized ${new Date(locked.at).toLocaleString()} by ${locked.by}`}
          >
            <Lock className="h-3.5 w-3.5" /> Finalized
          </span>
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => setConfirm("reopen")}>
            {busy === "reopen" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockOpen className="h-4 w-4" />}
            Reopen
          </Button>
        </>
      ) : (
        <>
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={onRecalc}>
            {busy === "recalc" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
            Recalculate
          </Button>
          <Button variant="gold" size="sm" disabled={busy !== null} onClick={() => setConfirm("finalize")}>
            {busy === "finalize" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Create report & lock month
          </Button>
        </>
      )}

      <AlertDialog open={confirm === "finalize"} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create the reports and lock {month}?</AlertDialogTitle>
            <AlertDialogDescription>
              This recalculates the month one last time, then freezes everything the dashboard shows - scores, zones,
              ranks, Top 3 and the written notes - and stores each person's report card as the copy everyone downloads
              from now on. Attendance uploads, new ratings and audits will no longer change it unless you reopen the
              month.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => runFinalize(false)}>Create & lock</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirm === "reopen"} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reopen {month}?</AlertDialogTitle>
            <AlertDialogDescription>
              Scores will be recalculated from the latest data again, and the stored report cards will be replaced the
              next time you lock the month.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runReopen}>Reopen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pending.length > 0} onOpenChange={(o) => !o && setPending([])}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending.length} people are still pending</AlertDialogTitle>
            <AlertDialogDescription>
              {pending.join(", ")}. They are missing an input (director ratings, the Claude audit or attendance).
              Locking now would freeze them without a score, and their report card would say "not scored yet".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPending([]);
                void runFinalize(true);
              }}
            >
              Finalize anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
