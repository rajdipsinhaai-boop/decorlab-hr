import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MessageSquareText, Upload } from "lucide-react";
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
import { getWhatsAppUploadHistory, uploadWhatsAppExport } from "@/lib/hr.functions";
import type { WhatsAppGroup } from "@/lib/hr-types";
import { currentMonthLabel, fileToBase64, monthOptions } from "./month-options";
import { useRequestPolling } from "./useRequestPolling";

const GROUPS: WhatsAppGroup[] = ["Decorlab Designers Group", "Decorlab Supervisors Group"];
const MAX_BYTES = 20 * 1024 * 1024;

export function UploadWhatsAppCard({ months }: { months: string[] }) {
  const options = monthOptions(months);
  const [group, setGroup] = useState<WhatsAppGroup>(GROUPS[0]!);
  const [month, setMonth] = useState(currentMonthLabel());
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = useServerFn(uploadWhatsAppExport);
  const fetchHistory = useServerFn(getWhatsAppUploadHistory);
  const poll = useRequestPolling();

  const { data: history, refetch } = useQuery({
    queryKey: ["whatsapp-history"],
    queryFn: () => fetchHistory(),
    staleTime: 120_000,
  });

  const onPick = (f: File | null) => {
    if (f && !f.name.toLowerCase().endsWith(".txt")) {
      toast.error("Only .txt chat exports are accepted.");
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
    try {
      const base64 = await fileToBase64(file);
      const { requestId } = await submit({
        data: { month, filename: file.name, base64, group },
      });
      toast.success("Chat export queued", { description: `${group} · ${month}` });
      setFile(null);
      refetch();
      poll.start(requestId, {
        onDone: () => {
          setBusy(false);
          toast.success("WhatsApp export processed", { duration: 12000 });
          refetch();
        },
        onFailed: () => {
          setBusy(false);
          toast.error("WhatsApp export failed", {
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
        <MessageSquareText className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold tracking-tight">Upload WhatsApp Chat Export</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Export chat from WhatsApp (Chat → More → Export Chat → Without Media) for each group at the end
        of every month and upload the .txt file here.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Group</Label>
          <Select value={group} onValueChange={(v) => setGroup(v as WhatsAppGroup)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {GROUPS.map((g) => (
                <SelectItem key={g} value={g}>
                  <span className="flex flex-col">
                    <span>{g}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {history?.[g] ? `Last uploaded: ${history[g]}` : "No uploads yet"}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {history?.[group] ? `Last uploaded: ${history[group]}` : "No uploads yet for this group"}
          </p>
        </div>
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
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Chat export (.txt)</Label>
        <Input
          type="file"
          accept="text/plain,.txt"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          className="file:mr-3 file:rounded file:border-0 file:bg-primary/15 file:px-2 file:py-1 file:text-xs file:text-primary"
        />
      </div>

      <Button className="mt-auto w-full sm:w-auto" disabled={!file || busy} onClick={onSubmit}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {busy ? "Processing…" : "Upload chat export"}
      </Button>
    </div>
  );
}