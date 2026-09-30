import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import reportCards from "@/data/report-cards.json";
import augustReportPdfs from "@/data/august-report-pdfs.json";
import { loadDashboard } from "@/lib/hr.server";
import { buildReportCard } from "@/lib/cron/report-pdf.server";

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
        const month = params.get("month") === "August 2026" ? "August 2026" : "July 2026";

        const profile = await resolveProfile(context as never);
        const isAdmin = profile.role === "admin";
        const isOwn = Boolean(
          profile.employeeName && profile.employeeName.toLowerCase() === name.toLowerCase(),
        );
        if (!isAdmin && !isOwn) return new Response("Not authorized", { status: 403 });

        const record = REPORT_CARDS[name.toLowerCase()];
        let bytes: Uint8Array;
        let filename: string;
        if (month === "August 2026") {
          const embeddedPdf = AUGUST_REPORT_PDFS[name.toLowerCase()];
          if (embeddedPdf) {
            bytes = Buffer.from(embeddedPdf.pdfBase64, "base64");
            filename = embeddedPdf.filename;
          } else {
            const dashboard = await loadDashboard(month);
            const employee = dashboard.employees.find(
              (entry) => entry.name.toLowerCase() === name.toLowerCase(),
            );
            if (!employee) return new Response("Report card not found", { status: 404 });
            bytes = await buildReportCard(employee, dashboard.month);
            filename = `${employee.name} - Report Card - ${dashboard.month}.pdf`;
          }
        } else if (record?.pdfBase64) {
          bytes = Buffer.from(record.pdfBase64, "base64");
          filename = record.pdfFilename;
        } else {
          const dashboard = await loadDashboard(month);
          const employee = dashboard.employees.find(
            (entry) => entry.name.toLowerCase() === name.toLowerCase(),
          );
          if (!employee) return new Response("Report card not found", { status: 404 });
          bytes = await buildReportCard(employee, dashboard.month);
          filename = `${employee.name} - Report Card - ${dashboard.month}.pdf`;
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
