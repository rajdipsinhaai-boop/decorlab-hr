import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { uploadAttendance } from "@/lib/hr.functions";
import { currentMonthLabel, fileToBase64, monthOptions } from "./month-options";
import { useRequestPolling } from "./useRequestPolling";

const MAX_BYTES = 20 * 1024 * 1024;

export function UploadAttendanceCard({ months }: { months: string[] }) {
  const options = monthOptions(months);
  const [month, setMonth] = useState(currentMonthLabel());
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = useServerFn(uploadAttendance);
  const poll = useRequestPolling();

  const onPick = (f: File | null) => {
    if (f && !f.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are accepted.");
      return;
    }
    if (f && f.size > MAX_BYTES) {
      toast.error("That PDF is larger than 20MB.");
      return;
    }
    setFile(f);
  };

  const onSubmit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const base64 = await fileToBase64(file);
      const { requestId } = await submit({
        data: { month, filename: file.name, base64 },
      });
      toast.success("Attendance upload queued", { description: `${month} · uploaded to Drive` });
      setFile(null);
      poll.start(requestId, {
        onDone: () => {
          setBusy(false);
          toast.success("Attendance processed and Daily Attendance tab updated", { duration: 12000 });
        },
        onFailed: () => {
          setBusy(false);
          toast.error("Attendance processing failed", {
            description: "Please check the uploaded file with Rajdipsinh.",
          });
        },
      });
    } catch (err) {
      setBusy(false);
      toast.error("Upload failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  return (
    <div className="panel flex h-full flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold tracking-tight">Upload Attendance</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Upload the monthly attendance PDF exported from the attendance system. It's saved to Drive and
        queued for processing.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Month</Label>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {options.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">PDF file</Label>
          <Input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            className="file:mr-3 file:rounded file:border-0 file:bg-primary/15 file:px-2 file:py-1 file:text-xs file:text-primary"
          />
        </div>
      </div>

      <Button className="mt-auto w-full sm:w-auto" disabled={!file || busy} onClick={onSubmit}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {busy ? "Processing…" : "Upload attendance"}
      </Button>
    </div>
  );
}