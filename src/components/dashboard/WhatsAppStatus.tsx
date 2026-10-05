import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MessageCircle, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getWhatsAppStatus, sendWhatsAppReports, type WhatsAppStatus as Status } from "@/lib/hr.functions";

const TONE = {
  sent: "border-success/40 bg-success/10 text-success",
  failed: "border-danger/40 bg-danger/10 text-danger",
  pending: "border-border bg-muted/30 text-muted-foreground",
  test: "border-warning/40 bg-warning/10 text-warning",
} as const;

/** Admin view of the WhatsApp report-card send for the selected month. */
export function WhatsAppStatus({ month }: { month: string }) {
  const load = useServerFn(getWhatsAppStatus);
  const send = useServerFn(sendWhatsAppReports);
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setError(null);
    load({ data: { month } })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load WhatsApp status."));
  }, [load, month]);
  useEffect(refresh, [refresh]);

  const run = async () => {
    setBusy(true);
    try {
      const r = await send({ data: { month } });
      if (r.error) toast.error("Some messages failed", { description: r.error });
      else toast.success("WhatsApp send finished");
    } catch (e) {
      toast.error("Could not send", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const count = (s: string) => data?.rows.filter((r) => r.status === s).length ?? 0;

  return (
    <div className="panel flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <MessageCircle className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold tracking-tight">WhatsApp report cards · {month}</h3>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={busy}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button size="sm" onClick={run} disabled={busy || !data?.finalized || !data?.configured}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {count("failed") || count("sent") ? "Send / retry remaining" : "Send now"}
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {data ? (
        <>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full border border-border px-2.5 py-1">Template: {data.template}</span>
            <span className={`rounded-full border px-2.5 py-1 ${data.finalized ? TONE.sent : TONE.pending}`}>
              {data.finalized ? "Month finalized" : "Month not finalized yet"}
            </span>
            <span className={`rounded-full border px-2.5 py-1 ${data.configured ? TONE.sent : TONE.failed}`}>
              {data.configured ? "API configured" : "API keys missing"}
            </span>
            <span className={`rounded-full border px-2.5 py-1 ${data.sendingEnabled ? TONE.sent : TONE.pending}`}>
              {data.sendingEnabled ? "Sending ON" : "Sending OFF (dry run)"}
            </span>
            {data.testMode ? (
              <span className={`rounded-full border px-2.5 py-1 ${TONE.failed}`}>
                TEST MODE: all messages go to the test number
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {count("sent")} sent · {count("failed")} failed · {count("pending") + count("test")} not sent yet{count("test") ? ` (${count("test")} only tested)` : ""}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-2 font-medium">Employee</th>
                  <th className="px-2 font-medium">Phone</th>
                  <th className="px-2 font-medium">Status</th>
                  <th className="px-2 font-medium">When</th>
                  <th className="px-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.employeeId} className="border-t border-border">
                    <td className="py-1.5 pr-2">
                      <span className="font-medium">{r.name}</span>
                      <span className="block text-[10px] text-muted-foreground">{r.role}</span>
                    </td>
                    <td className="px-2 tabular-nums">{r.phone ?? "—"}</td>
                    <td className="px-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${TONE[r.status]}`}>
                        {r.status === "pending" ? "Not sent" : r.status === "sent" ? "Sent" : r.status === "test" ? "Test only" : "Failed"}
                      </span>
                    </td>
                    <td className="px-2 text-muted-foreground">
                      {r.sentAt ? new Date(r.sentAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-2 text-muted-foreground">{r.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : !error ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
    </div>
  );
}
