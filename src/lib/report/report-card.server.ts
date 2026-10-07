import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { fmtDay } from "../attendance/metrics";
import type { AttendanceDay, DprActivityEntry, ScoreCardModel } from "../hr-types";

// Palette taken from the July 2026 report cards.
const NAVY = rgb(0.06, 0.12, 0.25);
const GOLD = rgb(0.74, 0.55, 0.14);
const INK = rgb(0.13, 0.14, 0.17);
const MUTED = rgb(0.45, 0.47, 0.52);
const TRACK = rgb(0.92, 0.9, 0.86);
const RULE = rgb(0.9, 0.88, 0.84);
const RED = rgb(0.77, 0.25, 0.2);
const AMBER = rgb(0.74, 0.5, 0.12);
const GREEN = rgb(0.13, 0.49, 0.25);
const TINT = { RED: rgb(0.99, 0.91, 0.9), YELLOW: rgb(1, 0.96, 0.88), GREEN: rgb(0.91, 0.97, 0.93) };

const W = 595;
const H = 842;
const M = 46;

const WINANSI_EXTRA = new Set([0x2014, 0x2013, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x20ac]);
/** The built-in PDF fonts only know WinAnsi; anything else would throw, so map or drop it. */
export function winAnsi(text: string): string {
  return text
    .replace(/→/g, "->")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/[→⇒]/g, "->")
    .split("")
    .map((ch) => {
      const c = ch.charCodeAt(0);
      return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(c) ? ch : c === 0x0a ? " " : "?";
    })
    .join("");
}

const colorFor = (score: number | null): RGB => (score === null ? MUTED : score >= 75 ? GREEN : score >= 60 ? AMBER : RED);
const ragColor = (rag: string | null): RGB => (rag === "GREEN" ? GREEN : rag === "YELLOW" ? AMBER : rag === "RED" ? RED : MUTED);

interface Ctx {
  pdf: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  page: PDFPage;
  y: number; // distance from the top of the page
  model: ScoreCardModel;
  position: string;
}

const yy = (c: Ctx, y = c.y) => H - y;

function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of winAnsi(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > max && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

function roundedRect(page: PDFPage, x: number, top: number, w: number, h: number, r: number, fill: RGB, border?: RGB) {
  const rr = Math.min(r, h / 2, w / 2);
  const path = `M ${rr} 0 H ${w - rr} Q ${w} 0 ${w} ${rr} V ${h - rr} Q ${w} ${h} ${w - rr} ${h} H ${rr} Q 0 ${h} 0 ${h - rr} V ${rr} Q 0 0 ${rr} 0 Z`;
  page.drawSvgPath(path, { x, y: H - top, color: fill, ...(border ? { borderColor: border, borderWidth: 0.8 } : {}) });
}

function frame(c: Ctx) {
  const { page, model } = c;
  page.drawRectangle({ x: 20, y: 20, width: W - 40, height: H - 40, borderColor: RULE, borderWidth: 0.8 });
  // top bar: gold up to the score, navy for the rest (like the printed cards)
  const inner = W - 40;
  const share = model.finalScore === null ? 0 : Math.max(0, Math.min(1, model.finalScore / 100));
  page.drawRectangle({ x: 20, y: H - 24, width: inner * share, height: 4, color: GOLD });
  page.drawRectangle({ x: 20 + inner * share, y: H - 24, width: inner * (1 - share), height: 4, color: NAVY });
}

function footer(c: Ctx) {
  const { page, italic, bold } = c;
  const tag = winAnsi(`DECORLAB KRA · ${c.position}`);
  const lines = wrap(
    "This score blends real Rdash coordination/attendance data with System Work Feedback - it is not manual opinion alone. Questions about any number above, ask directly.",
    italic,
    7.5,
    W - M * 2 - bold.widthOfTextAtSize(tag, 8) - 16,
  );
  lines.forEach((l, i) => page.drawText(l, { x: M, y: 50 - i * 10, size: 7.5, font: italic, color: MUTED }));
  page.drawText(tag, { x: W - M - bold.widthOfTextAtSize(tag, 8), y: 50, size: 8, font: bold, color: MUTED });
}

function newPage(c: Ctx) {
  c.page = c.pdf.addPage([W, H]);
  c.y = 56;
  frame(c);
}

function ensure(c: Ctx, need: number) {
  if (c.y + need > H - 68) {
    footer(c);
    newPage(c);
  }
}

function heading(c: Ctx, text: string) {
  ensure(c, 48);
  c.y += 12;
  c.page.drawRectangle({ x: M, y: yy(c) - 9, width: 3, height: 11, color: GOLD });
  c.page.drawText(winAnsi(text), { x: M + 9, y: yy(c) - 8, size: 10, font: c.bold, color: NAVY });
  c.y += 8;
  c.page.drawLine({ start: { x: M, y: yy(c) - 4 }, end: { x: W - M, y: yy(c) - 4 }, thickness: 0.6, color: RULE });
  c.y += 20;
}

function header(c: Ctx) {
  const { page, bold, font, model } = c;
  c.y = 56;
  page.drawText("D E C O R L A B  ·  MONTHLY PERFORMANCE REPORT CARD", {
    x: M,
    y: yy(c),
    size: 8,
    font: bold,
    color: GOLD,
  });
  const period = winAnsi(`Review Period: ${model.month}`);
  page.drawText(period, { x: W - M - font.widthOfTextAtSize(period, 8.5), y: yy(c), size: 8.5, font, color: MUTED });
  c.y += 28;
  const name = winAnsi(model.name);
  page.drawText(name, { x: M, y: yy(c), size: 21, font: bold, color: NAVY });
  const nameW = bold.widthOfTextAtSize(name, 21);
  page.drawText(winAnsi(`·  ${model.role}`), { x: M + nameW + 8, y: yy(c), size: 11, font, color: MUTED });
  if (model.probationEnds) {
    c.y += 14;
    page.drawText(winAnsi(`ON PROBATION  -  probation ends ${fmtDay(model.probationEnds)}`), { x: M, y: yy(c), size: 9, font: bold, color: GOLD });
  }
  c.y += 14;
  page.drawLine({ start: { x: M, y: yy(c) }, end: { x: W - M, y: yy(c) }, thickness: 1, color: rgb(0.9, 0.82, 0.55) });
  c.y += 22;
}

function scoreBox(c: Ctx) {
  const { page, bold, font, model } = c;
  const boxH = 112;
  const x = M;
  const w = W - M * 2;
  const rag = model.rag;
  const tint = rag ? TINT[rag] : rgb(0.95, 0.95, 0.96);
  roundedRect(page, x, c.y, w, boxH, 10, tint, rag ? ragColor(rag) : RULE);

  page.drawText("FINAL SCORE", { x: x + 18, y: yy(c) - 24, size: 8, font: bold, color: MUTED });
  const big = model.finalScore === null ? "Pending" : `${model.finalScore}%`;
  const bigSize = model.finalScore === null ? 30 : 38;
  page.drawText(big, { x: x + 18, y: yy(c) - 62, size: bigSize, font: bold, color: ragColor(rag) });
  const bigW = bold.widthOfTextAtSize(big, bigSize);
  if (rag) {
    const pillW = bold.widthOfTextAtSize(rag, 8) + 22;
    roundedRect(page, x + 18 + bigW + 14, c.y + 36, pillW, 19, 9.5, ragColor(rag));
    page.drawText(rag, { x: x + 18 + bigW + 25, y: yy(c) - 49, size: 8, font: bold, color: rgb(1, 1, 1) });
  }
  const band = wrap(model.bandText, font, 8.5, w * 0.5);
  band.forEach((l, i) =>
    page.drawText(l, { x: x + w - 18 - font.widthOfTextAtSize(l, 8.5), y: yy(c) - 24 - i * 11, size: 8.5, font, color: MUTED }),
  );

  // gauge: red 0-60, amber 60-75, green 75-100
  const gx = x + 18;
  const gw = w - 36;
  const gy = c.y + 82;
  const seg = (from: number, to: number, col: RGB) =>
    page.drawRectangle({ x: gx + (gw * from) / 100, y: H - gy - 6, width: (gw * (to - from)) / 100, height: 6, color: col });
  seg(0, 60, RED);
  seg(60, 75, AMBER);
  seg(75, 100, GREEN);
  [0, 60, 75, 100].forEach((v) => {
    const t = String(v);
    const tx = gx + (gw * v) / 100 - (v === 0 ? 0 : v === 100 ? font.widthOfTextAtSize(t, 7) : font.widthOfTextAtSize(t, 7) / 2);
    page.drawText(t, { x: tx, y: H - gy - 17, size: 7, font, color: MUTED });
  });
  if (model.finalScore !== null) {
    const mx = gx + (gw * Math.max(0, Math.min(100, model.finalScore))) / 100;
    page.drawCircle({ x: mx, y: H - gy - 3, size: 5, color: rgb(1, 1, 1), borderColor: NAVY, borderWidth: 1.8 });
  }
  c.y += boxH + 14;
}

function components(c: Ctx) {
  const { page, bold, font, model } = c;
  heading(c, "HOW THIS SCORE WAS BUILT");
  for (const comp of model.components) {
    const noteLines = wrap(comp.note, font, 8, W - M * 2);
    ensure(c, 30 + noteLines.length * 10);
    const label = winAnsi(comp.label);
    page.drawText(label, { x: M, y: yy(c), size: 10, font: bold, color: INK });
    const lw = bold.widthOfTextAtSize(label, 10);
    page.drawText(winAnsi(`  (weight ${comp.weight}%)`), { x: M + lw, y: yy(c), size: 8.5, font, color: MUTED });
    const val = comp.score === null ? "Pending" : `${comp.score}%`;
    page.drawText(val, { x: W - M - bold.widthOfTextAtSize(val, 11), y: yy(c), size: 11, font: bold, color: colorFor(comp.score) });
    c.y += 10;
    const bw = W - M * 2;
    roundedRect(page, M, c.y, bw, 5, 2.5, TRACK);
    if (comp.score !== null && comp.score > 0) {
      roundedRect(page, M, c.y, Math.max(5, (bw * Math.min(100, comp.score)) / 100), 5, 2.5, colorFor(comp.score));
    }
    c.y += 15;
    noteLines.forEach((l, i) => page.drawText(l, { x: M, y: yy(c) - i * 10, size: 8, font, color: MUTED }));
    c.y += noteLines.length * 10 + 8;
  }
}

function kra(c: Ctx) {
  const { page, font, bold, model } = c;
  if (!model.kra.length) return;
  heading(c, "SYSTEM WORK FEEDBACK — KRA BREAKDOWN");
  const colW = (W - M * 2 - 20) / 2;
  const rows = Math.ceil(model.kra.length / 2);
  ensure(c, rows * 19 + 6);
  model.kra.forEach((k, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = M + col * (colW + 20);
    const ty = c.y + row * 19;
    page.drawText(winAnsi(k.name.length > 46 ? `${k.name.slice(0, 44)}...` : k.name), {
      x,
      y: H - ty,
      size: 8.8,
      font,
      color: INK,
    });
    if (k.rating === null) {
      const label = "NOT YET RATED";
      const cw = bold.widthOfTextAtSize(label, 6.5) + 12;
      roundedRect(page, x + colW - cw, ty - 9, cw, 13, 4, rgb(0.93, 0.85, 0.6));
      page.drawText(label, { x: x + colW - cw + 6, y: H - ty + 0.5, size: 6.5, font: bold, color: rgb(0.45, 0.32, 0.05) });
    } else {
      for (let d = 0; d < 5; d++) {
        page.drawCircle({
          x: x + colW - 52 + d * 12,
          y: H - ty + 3,
          size: 3.2,
          color: d < Math.round(k.rating) ? NAVY : rgb(0.86, 0.86, 0.84),
        });
      }
    }
    page.drawLine({
      start: { x, y: H - ty - 6 },
      end: { x: x + colW, y: H - ty - 6 },
      thickness: 0.4,
      color: RULE,
    });
  });
  c.y += rows * 19 + 4;
}

function bullets(c: Ctx, title: string, items: string[], marker: string) {
  if (!items.length) return;
  heading(c, title);
  for (const item of items) {
    const lines = wrap(item.replace(/^[-•>]\s*/, ""), c.font, 9, W - M * 2 - 18);
    ensure(c, lines.length * 12 + 8);
    c.page.drawText(marker, { x: M + 2, y: yy(c), size: 9, font: c.bold, color: GOLD });
    lines.forEach((l, i) => c.page.drawText(l, { x: M + 18, y: yy(c) - i * 12, size: 9, font: c.font, color: INK }));
    c.y += lines.length * 12 + 5;
  }
}

function pending(c: Ctx) {
  if (!c.model.pending.length) return;
  bullets(c, "WHAT IS STILL NEEDED", c.model.pending.map((p) => `Waiting for ${p}.`), "-");
}

const STATUS_COLOR: Record<string, RGB> = {
  Present: GREEN,
  Incomplete: AMBER,
  Absent: RED,
  Leave: rgb(0.5, 0.6, 0.8),
  "Week Off": rgb(0.8, 0.8, 0.8),
  Holiday: rgb(0.8, 0.8, 0.8),
};

/**
 * The attendance calendar and graded DPR days. They flow on from the previous section instead of
 * forcing a new page, so a card stays on two pages and only spills onto a third when it cannot fit.
 */
function evidence(c: Ctx, days: AttendanceDay[], dpr: DprActivityEntry[]) {
  if (!days.length && !dpr.length) return;
  if (days.length) {
    const cell = 26;
    const perRow = Math.floor((W - M * 2) / (cell + 4));
    // heading + calendar + legend stay together: they move to the next page as one block
    ensure(c, 48 + Math.ceil(days.length / perRow) * (cell + 4) + 24);
    heading(c, "ATTENDANCE THIS MONTH");
    days.forEach((d, i) => {
      const x = M + (i % perRow) * (cell + 4);
      const ty = c.y + Math.floor(i / perRow) * (cell + 4);
      roundedRect(c.page, x, ty, cell, cell, 4, STATUS_COLOR[d.status] ?? rgb(0.85, 0.85, 0.85));
      const num = d.date.split("/")[0] ?? "";
      c.page.drawText(num, { x: x + cell / 2 - c.bold.widthOfTextAtSize(num, 8) / 2, y: H - ty - 14, size: 8, font: c.bold, color: rgb(1, 1, 1) });
      c.page.drawText(d.hours ? `${d.hours.toFixed(1)}h` : "-", { x: x + cell / 2 - 6, y: H - ty - 22, size: 5.5, font: c.font, color: rgb(1, 1, 1) });
    });
    c.y += Math.ceil(days.length / perRow) * (cell + 4) + 6;
    const legend = Object.entries({ Present: "Present (hours shown)", Incomplete: "Missing punch", Absent: "Absent", Leave: "Leave", "Week Off": "Week off / holiday" });
    let lx = M;
    for (const [k, label] of legend) {
      c.page.drawRectangle({ x: lx, y: yy(c) - 7, width: 7, height: 7, color: STATUS_COLOR[k]! });
      c.page.drawText(label, { x: lx + 11, y: yy(c) - 6, size: 7.5, font: c.font, color: MUTED });
      lx += 24 + c.font.widthOfTextAtSize(label, 7.5);
    }
    c.y += 14;
  }
  if (dpr.length) {
    heading(c, "DPR REPORTS GRADED");
    for (const d of dpr.slice(0, 40)) {
      ensure(c, 14);
      c.page.drawText(winAnsi(d.date), { x: M, y: yy(c), size: 8, font: c.bold, color: INK });
      c.page.drawText(winAnsi(d.grade || "-"), { x: M + 70, y: yy(c), size: 8, font: c.bold, color: colorFor(/excellent|good/i.test(d.grade) ? 80 : /partial/i.test(d.grade) ? 65 : 30) });
      const text = wrap(d.summary, c.font, 8, W - M * 2 - 130)[0] ?? "";
      c.page.drawText(text, { x: M + 130, y: yy(c), size: 8, font: c.font, color: MUTED });
      c.y += 13;
    }
  }
}

/**
 * One report card as a PDF. `index`/`total` print as "DECORLAB KRA · n / N" when a whole batch is built.
 * With `evidence`, a second page shows the attendance calendar and graded DPR days.
 */
export async function buildReportCardPdf(
  model: ScoreCardModel,
  opts: { index?: number; total?: number; evidence?: { days: AttendanceDay[]; dpr: DprActivityEntry[] } } = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(winAnsi(`${model.name} - ${model.month} Report Card`));
  pdf.setAuthor("Decorlab");
  const [font, bold, italic] = await Promise.all([
    pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold),
    pdf.embedFont(StandardFonts.HelveticaOblique),
  ]);
  const c: Ctx = {
    pdf,
    font,
    bold,
    italic,
    page: pdf.addPage([W, H]),
    y: 56,
    model,
    position: opts.index && opts.total ? `${opts.index} / ${opts.total}` : model.month,
  };
  frame(c);
  header(c);
  scoreBox(c);
  pending(c);
  components(c);
  kra(c);
  bullets(c, "WHY THIS SCORE", model.why, "-");
  bullets(c, "WHAT TO IMPROVE NEXT MONTH", model.improve, ">");
  if (opts.evidence) evidence(c, opts.evidence.days, opts.evidence.dpr);
  footer(c);
  return pdf.save();
}
