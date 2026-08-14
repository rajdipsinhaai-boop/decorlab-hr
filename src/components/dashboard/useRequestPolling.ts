import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getReportStatus } from "@/lib/hr.functions";

const POLL_MS = 18000;

export function useRequestPolling() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checkStatus = useServerFn(getReportStatus);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const stop = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const start = (
    requestId: string,
    handlers: { onDone: (driveLink: string) => void; onFailed: () => void },
  ) => {
    stop();
    timerRef.current = setInterval(async () => {
      try {
        const row = await checkStatus({ data: { requestId } });
        if (!row) return;
        if (row.status === "DONE") {
          stop();
          handlers.onDone(row.driveLink);
        } else if (row.status === "FAILED") {
          stop();
          handlers.onFailed();
        }
      } catch (err) {
        console.error(err);
      }
    }, POLL_MS);
  };

  return { start, stop };
}