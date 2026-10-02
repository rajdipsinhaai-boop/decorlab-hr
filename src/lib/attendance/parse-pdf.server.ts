import { getDocumentProxy } from "unpdf";
import { assembleReport } from "./assemble";
import { addDaysIso, dmyToIso, hhmmToMinutes } from "./normalize";
import { AttendanceParseError, type ParsedDay, type ParsedReport } from "./types";

interface Tok {
  s: string;
  x: number;
}
interface Line {
  y: number;
  toks: Tok[];
}

const TITLE_RE = /From\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+To\s+(\d{1,2}\/\d{1,2}\/\d{4})/i;
const DATE_ROW_RE = /^(\d{1,2}\/\d{1,2}\/\d{4})$/;
const ID_RE = /^[A-Za-z]{0,3}\d+$/;
const TIME_RE = /^(\d{1,2}:\d{2})(?:\s+-?\d+)?$/;
const CODE_RE = /^[A-Z]{1,3}$/;

/** Column anchors (x of each header word), read from the header lines of a page. */
interface Anchors {
  name: number;
  shift: number;
  /** x of: IN, OUT, IN2, OUT2, 1st, 2nd, Late, Early, ..., Work, Man, Reason */
  in: number;
  out: number;
  in2: number;
  out2: number;
  first: number;
  second: number;
  late: number;
  early: number;
  work: number;
  man: number;
  reason: number;
  /** Everything between Early and Work (leave / overtime columns) is not used. */
  midStart: number;
}

function groupLines(items: { str: string; transform: number[] }[]): Line[] {
  const toks = items
    .filter((i) => i.str.trim())
    .map((i) => ({ s: i.str.trim(), x: i.transform[4]!, y: i.transform[5]! }));
  toks.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const t of toks) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - t.y) <= 2) last.toks.push({ s: t.s, x: t.x });
    else lines.push({ y: t.y, toks: [{ s: t.s, x: t.x }] });
  }
  for (const l of lines) l.toks.sort((a, b) => a.x - b.x);
  return lines;
}

function readAnchors(lines: Line[]): Anchors | null {
  const head = lines.find((l) => l.toks[0]?.s === "User" && l.toks.some((t) => t.s === "Shift"));
  if (!head) return null;
  const xs = (label: string) => head.toks.filter((t) => t.s === label).map((t) => t.x);
  const one = (label: string) => xs(label)[0];
  const ins = xs("IN-");
  const outs = xs("OUT-");
  const a = {
    name: one("Name"),
    shift: one("Shift"),
    in: ins[0],
    in2: ins[1],
    out: outs[0],
    out2: outs[1],
    first: one("1st"),
    second: one("2nd"),
    late: one("Late"),
    early: one("Early"),
    work: one("Work"),
    man: one("Man"),
    reason: one("Reason"),
  };
  if (Object.values(a).some((v) => v === undefined)) return null;
  return { ...(a as Omit<Anchors, "midStart">), midStart: a.early! + 20 };
}

/** Index of the anchor nearest to x, among columns sorted left to right. */
function nearest(x: number, cols: [string, number][]): string {
  let best = cols[0]!;
  for (const c of cols) if (Math.abs(c[1] - x) < Math.abs(best[1] - x)) best = c;
  return best[0];
}

function parsePerson(line: Line, a: Anchors, date: string): ParsedDay | null {
  const [idTok, ...rest] = line.toks;
  if (!idTok || !ID_RE.test(idTok.s)) return null;

  // Everything left of the first punch column is "<name> <shift>". pdf.js sometimes fuses the
  // last name word with the shift into one item ("Yadav DR"), so split on the text, not the tokens.
  const leading = rest.filter((t) => t.x < a.in - 8);
  const nameAndShift = /^(.+?)\s+([A-Z]{1,3})$/.exec(leading.map((t) => t.s).join(" "));
  if (!nameAndShift) return null;
  const name = nameAndShift[1]!;
  const shift = nameAndShift[2]!;

  const cols: [string, number][] = [
    ["in", a.in],
    ["out", a.out],
    ["in2", a.in2],
    ["out2", a.out2],
    ["first", a.first],
    ["second", a.second],
    ["late", a.late],
    ["early", a.early],
    ["mid", (a.early + a.work) / 2],
    ["work", a.work],
    ["man", a.man],
    ["reason", a.reason],
  ];
  const cell: Record<string, string[]> = {};
  for (const t of rest) {
    if (t.x < a.in - 8) continue;
    // Codes and times sit slightly left of their header; free text sits to the right of "Reason".
    const col = nearest(t.x + 4, cols);
    (cell[col] ??= []).push(t.s);
  }
  const one = (k: string) => cell[k]?.join(" ").trim() ?? "";
  const clock = (k: string): string | null => TIME_RE.exec(one(k))?.[1] ?? null;

  return {
    workDate: date,
    cosecId: idTok.s.toUpperCase(),
    name,
    shift,
    inAt: clock("in") ? `${date}T${pad(clock("in")!)}:00` : null,
    outAt: clock("out") ? `${date}T${pad(clock("out")!)}:00` : null,
    in2At: clock("in2") ? `${date}T${pad(clock("in2")!)}:00` : null,
    out2At: clock("out2") ? `${date}T${pad(clock("out2")!)}:00` : null,
    firstHalf: one("first").toUpperCase(),
    secondHalf: one("second").toUpperCase(),
    lateInMin: hhmmToMinutes(one("late")),
    earlyOutMin: hhmmToMinutes(one("early")),
    workMin: hhmmToMinutes(one("work")),
    manualEntry: /^y/i.test(one("man")),
    reason: one("reason") || null,
  };
}

const pad = (hhmm: string) => (hhmm.length === 4 ? `0${hhmm}` : hhmm);

/**
 * The PDF prints clock times without a date, so a punch that is earlier on the clock than the one
 * before it is assumed to be on the next day (night shifts). The Excel export carries real dates.
 */
function roll(day: ParsedDay): ParsedDay {
  let prev: string | null = null;
  const next = (key: "inAt" | "outAt" | "in2At" | "out2At") => {
    const v = day[key];
    if (!v) return;
    if (prev && v < prev) {
      const t = addDaysIso(v.slice(0, 10), 1);
      day[key] = `${t}${v.slice(10)}`;
    }
    prev = day[key];
  };
  next("inAt");
  next("outAt");
  next("in2At");
  next("out2At");
  return day;
}

export async function parseCosecPdf(bytes: Uint8Array): Promise<ParsedReport> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // pdf.js transfers (and detaches) the buffer it is given.
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch {
    throw new AttendanceParseError("That PDF could not be opened. It may be damaged or password protected.");
  }

  let period: { start: string; end: string } | null = null;
  let runBy: string | null = null;
  const days: ParsedDay[] = [];
  const warnings: string[] = [];
  let anchors: Anchors | null = null;
  let currentDate: string | null = null;
  let sawHeader = false;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines = groupLines(content.items as { str: string; transform: number[] }[]);
    anchors = readAnchors(lines) ?? anchors;
    if (anchors) sawHeader = true;

    for (const line of lines) {
      const joined = line.toks.map((t) => t.s).join(" ");
      const title = TITLE_RE.exec(joined);
      if (title && !period) {
        const start = dmyToIso(title[1]!);
        const end = dmyToIso(title[2]!);
        if (start && end) period = { start, end };
      }
      const run = /^Run by:?\s+(\S+)/i.exec(joined);
      if (run && !runBy) runBy = run[1]!;

      const first = line.toks[0]?.s ?? "";
      const dm = DATE_ROW_RE.exec(first);
      if (dm && /^\(?[A-Za-z]+\)?$/.test(line.toks[1]?.s ?? "") && line.toks.length <= 3) {
        currentDate = dmyToIso(dm[1]!);
        continue;
      }
      if (!anchors || !currentDate) continue;
      const day = parsePerson(line, anchors, currentDate);
      if (day) days.push(roll(day));
    }
  }

  if (!sawHeader) {
    throw new AttendanceParseError(
      "This does not look like the biometric attendance report (no User / Name / 1st Half header found). " +
        "If the PDF is a scan or a different layout, upload the Excel export instead.",
    );
  }
  return assembleReport({
    format: "pdf",
    periodStart: period?.start ?? null,
    periodEnd: period?.end ?? null,
    runBy,
    days,
    warnings,
  });
}
