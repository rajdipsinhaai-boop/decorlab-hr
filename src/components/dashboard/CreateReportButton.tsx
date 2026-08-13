import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Loader2 } from "lucide-react";
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
import { createReportRequest, getReportStatus } from "@/lib/hr.functions";

const POLL_MS = 18000;

export function CreateReportButton({ month }: { month: string }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submit = useServerFn(createReportRequest);
  const checkStatus = useServerFn(getReportStatus);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const stopPolling = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    requestIdRef.current = null;
    setProcessing(false);
  };

  const startPolling = (requestId: string) => {
    requestIdRef.current = requestId;
    timerRef.current = setInterval(async () => {
      try {
        const row = await checkStatus({ data: { requestId } });
        if (!row) return;
        if (row.status === "DONE") {
          stopPolling();
          toast.success("Report cards are ready", {
            description: row.driveLink ? "Open the Drive folder to download them." : `Completed ${row.completedAt}`,
            action: row.driveLink
              ? { label: "View in Drive", onClick: () => window.open(row.driveLink, "_blank", "noopener") }
              : undefined,
            duration: 15000,
          });
        } else if (row.status === "FAILED") {
          stopPolling();
          toast.error("Report generation failed", {
            description: "The automation marked this request as FAILED. Please try again.",
          });
        }
      } catch (err) {
        console.error(err);
      }
    }, POLL_MS);
  };

  const onConfirm = async () => {
    setConfirmOpen(false);
    setProcessing(true);
    try {
      const { requestId } = await submit({ data: { month } });
      toast.success("Report request queued", { description: `${month} · request ${requestId.slice(0, 8)}` });
      startPolling(requestId);
    } catch (err) {
      setProcessing(false);
      toast.error("Could not queue the report", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  return (
    <>
      <Button
        variant="gold"
        size="lg"
        disabled={processing}
        onClick={() => setConfirmOpen(true)}
        className="w-full sm:w-auto"
      >
        {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
        {processing ? "Processing…" : "Create Report"}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate report cards for {month}?</AlertDialogTitle>
            <AlertDialogDescription>
              This queues a report request for <strong>{month}</strong>. The automation picks it up, builds the PDF
              report cards and uploads them to Drive. You'll be notified here when it's done.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>Yes, generate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}