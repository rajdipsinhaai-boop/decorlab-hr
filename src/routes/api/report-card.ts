import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import reportCards from "@/data/report-cards.json";
import augustReportPdfs from "@/data/august-report-pdfs.json";
import { loadDashboard } from "@/lib/hr.server";
import { buildReportCardPdf } from "@/lib/report/report-card.server";
import { modelFor } from "@/lib/report/model-for";
import { REPORT_BUCKET, reportPath } from "@/lib/report/generate.server";
import { monthKeyOf } from "@/lib/attendance/normalize";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Snapshot = {
  month: string;
  scoreBuilt: string[];
  whyScore: string[];
  improveNextMonth: string[];
  pdfFilename: string;
  pdfBase64: string;
};

const REPORT_CARDS = reportCards as Record<string, Snapshot>;

type AugustReportPdf = { filename: string; pdfBase64: string };
const AUGUST_REPORT_PDFS = augustReportPdfs as Record<string, AugustReportPdf>;

async function resolveProfile(context: { supabase: any; claims: any }) {
  const { resolveAccess } = await import("@/lib/access.server");
  return resolveAccess(context);
}

export const Route = createFileRoute("/api/report-card")({
  server: {
    middleware: [requireSupabaseAuth as never],
    handlers: {
      GET: async ({ request, context }) => {
        const params = new URL(request.url).searchParams;
        const name = params.get("name")?.trim() ?? "";
        if (!name) return new Response("Missing employee name", { status: 400 });
        const monthParam = params.get("month") ?? "";
        const profile = await resolveProfile(context as never);
        const isAdmin = profile.role === "admin";

        // One load serves both the ownership check and the PDF; an unknown month falls back to the latest.
        const dashboard = await loadDashboard(monthParam || undefined);
        const month = dashboard.month;
        const employee = dashboard.employees.find(
          (entry) => entry.name.toLowerCase() === name.toLowerCase(),
        );
        if (!isAdmin) {
          const { findOwn } = await import("@/lib/access.server");
          const mine = findOwn(dashboard.employees, profile);
          if (!mine || mine.name.toLowerCase() !== name.toLowerCase()) {
            return new Response("Not authorized", { status: 403 });
          }
        }
        if (!employee) return new Response("Report card not found", { status: 404 });

        // Months with a hand-made PDF on file serve that; every other month is generated from the data.
        const key = name.toLowerCase();
        const handMade =
          REPORT_CARDS[key]?.month === month
            ? { bytes: REPORT_CARDS[key]!.pdfBase64, filename: REPORT_CARDS[key]!.pdfFilename }
            : month === "August 2026" && AUGUST_REPORT_PDFS[key]
              ? { bytes: AUGUST_REPORT_PDFS[key]!.pdfBase64, filename: AUGUST_REPORT_PDFS[key]!.filename }
              : null;
        let bytes: Uint8Array | null = null;
        let filename = `${employee.name} - ${month} Report Card.pdf`;
        if (handMade?.bytes) {
          bytes = Buffer.from(handMade.bytes, "base64");
          filename = handMade.filename;
        } else if (dashboard.locked) {
          // A finalized month serves the exact PDF that was stored when it was locked.
          const monthKey = monthKeyOf(month);
          const stored = monthKey
            ? await supabaseAdmin.storage.from(REPORT_BUCKET).download(reportPath(monthKey, employee.id))
            : null;
          if (stored?.data) bytes = new Uint8Array(await stored.data.arrayBuffer());
        }
        if (!bytes) {
          bytes = await buildReportCardPdf(modelFor(employee, month), {
            evidence: { days: employee.days, dpr: employee.dprActivity },
          });
        }

        return new Response(bytes as unknown as BodyInit, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": String(bytes.byteLength),
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
            "Cache-Control": "private, no-store",
          },
        });
      },
    },
  },
});
