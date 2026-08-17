import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Employee } from "../hr-types";

const NAVY = rgb(0.043, 0.121, 0.227);
const GOLD = rgb(0.788, 0.635, 0.153);
const INK = rgb(0.12, 0.13, 0.16);
const MUTED = rgb(0.42, 0.45, 0.5);

function ragColor(rag: string) {
  if (rag === "GREEN") return rgb(0.16, 0.62, 0.36);
  if (rag === "YELLOW") return rgb(0.85, 0.65, 0.13);
  return rgb(0.79, 0.24, 0.24);
}

/** Compact one-page report card. Feedback is always "System Work Feedback". */
export async function buildReportCard(employee: Employee, month: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width } = page.getSize();
  const M = 48;

  page.drawRectangle({ x: 0, y: 762, width, height: 80, color: NAVY });
  page.drawText("DECORLAB", { x: M, y: 812, size: 16, font: bold, color: GOLD });
  page.drawText(`KRA Report Card — ${month}`, { x: M, y: 790, size: 11, font, color: rgb(1, 1, 1) });

  let y = 726;
  page.drawText(employee.name, { x: M, y, size: 20, font: bold, color: INK });
  y -= 18;
  page.drawText(`${employee.role}${employee.department ? ` · ${employee.department}` : ""}`, {
    x: M,
    y,
    size: 10,
    font,
    color: MUTED,
  });

  y -= 34;
  page.drawRectangle({ x: M, y: y - 24, width: width - M * 2, height: 52, color: rgb(0.96, 0.97, 0.98) });
  page.drawText(`Final Score: ${employee.score}%`, { x: M + 14, y: y + 8, size: 16, font: bold, color: INK });
  page.drawText(`RAG: ${employee.rag}`, {
    x: M + 14,
    y: y - 12,
    size: 12,
    font: bold,
    color: ragColor(employee.rag),
  });
  page.drawText(
    `Rank in role: ${employee.rankInRole ?? "-"}    Overall rank: ${employee.overallRank ?? "-"}`,
    { x: width / 2, y: y - 12, size: 10, font, color: MUTED },
  );

  y -= 62;
  page.drawText("Weighted score breakdown", { x: M, y, size: 12, font: bold, color: NAVY });
  y -= 18;
  for (const seg of employee.breakdown) {
    page.drawText(`${seg.label}`, { x: M, y, size: 10, font, color: INK });
    page.drawText(`${seg.score}%  ×  ${seg.weight}%  =  ${seg.contribution} pts`, {
      x: width - M - 170,
      y,
      size: 10,
      font,
      color: MUTED,
    });
    y -= 16;
  }

  if (employee.criteria.length) {
    y -= 14;
    page.drawText("Rated criteria (1-5)", { x: M, y, size: 12, font: bold, color: NAVY });
    y -= 18;
    for (const c of employee.criteria) {
      page.drawText(c.name.slice(0, 60), { x: M, y, size: 10, font, color: INK });
      page.drawText(`${c.rating} / 5`, { x: width - M - 60, y, size: 10, font, color: MUTED });
      y -= 15;
      if (y < 200) break;
    }
  }

  y -= 14;
  page.drawText("Attendance", { x: M, y, size: 12, font: bold, color: NAVY });
  y -= 18;
  const lines = [
    `Present days: ${employee.presentDays}    Absent days: ${employee.absentDays}`,
    `Average hours per day: ${employee.avgHours}h`,
    `Punctuality deviation: ${employee.punctualityDeviation >= 0 ? "+" : ""}${employee.punctualityDeviation} min`,
  ];
  for (const line of lines) {
    page.drawText(line, { x: M, y, size: 10, font, color: INK });
    y -= 15;
  }

  if (employee.note) {
    y -= 12;
    page.drawText("System Work Feedback note", { x: M, y, size: 12, font: bold, color: NAVY });
    y -= 16;
    const words = employee.note.split(/\s+/);
    let line = "";
    for (const w of words) {
      if ((line + " " + w).length > 92) {
        page.drawText(line, { x: M, y, size: 10, font, color: INK });
        y -= 14;
        line = w;
      } else line = line ? `${line} ${w}` : w;
    }
    if (line) page.drawText(line, { x: M, y, size: 10, font, color: INK });
  }

  page.drawText(`Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, {
    x: M,
    y: 40,
    size: 8,
    font,
    color: MUTED,
  });

  return pdf.save();
}