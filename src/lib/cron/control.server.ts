import { batchGet, batchUpdateValues, updateValues } from "../sheets.server";

/** Control tab layout (header lives on sheet row 3, data starts on row 4). */
export const CONTROL_HEADERS = [
  "Request ID",
  "Requested At (UTC)",
  "Requested By",
  "Month",
  "Status",
  "Drive Folder Link",
  "Completed At (UTC)",
  "Type",
  "Last Touched At (UTC)",
  "Error Notes",
];

export const COL = {
  requestId: 0,
  requestedAt: 1,
  requestedBy: 2,
  month: 3,
  status: 4,
  driveLink: 5,
  completedAt: 6,
  type: 7,
  lastTouched: 8,
  errorNotes: 9,
} as const;

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

export interface QueueRow {
  sheetRow: number;
  requestId: string;
  requestedAt: string;
  requestedBy: string;
  month: string;
  status: string;
  driveLink: string;
  completedAt: string;
  type: "Create Report" | "Attendance Upload" | "WhatsApp Export";
  lastTouched: string;
  errorNotes: string;
}

export function utcStamp(d = new Date()) {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

export function parseStamp(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const ms = Date.parse(/z|[+-]\d{2}:?\d{2}$/i.test(t) ? t : `${t.replace(" ", "T")}Z`);
  return Number.isFinite(ms) ? ms : null;
}

const cell = (row: string[], i: number) => (row?.[i] ?? "").toString().trim();

function typeOf(raw: string): QueueRow["type"] {
  const t = raw.toLowerCase();
  if (t.includes("attendance")) return "Attendance Upload";
  if (t.includes("whatsapp")) return "WhatsApp Export";
  return "Create Report";
}

function isExampleRow(row: string[]): boolean {
  return row.some((v) => /example row\s*[–—-]\s*delete me/i.test((v ?? "").toString()));
}

/** Adds the Type / Last Touched At / Error Notes headers in place when missing. */
export async function ensureControlColumns(): Promise<void> {
  const range = "Control!A3:J3";
  const header = (await batchGet([range]))[range]?.[0] ?? [];
  const writes: { range: string; values: string[][] }[] = [];
  for (const i of [COL.type, COL.lastTouched, COL.errorNotes]) {
    if (!cell(header, i)) {
      writes.push({ range: `Control!${LETTERS[i]}3`, values: [[CONTROL_HEADERS[i]!]] });
    }
  }
  await batchUpdateValues(writes);
}

export async function readQueue(): Promise<QueueRow[]> {
  const range = "Control!A3:J500";
  const grid = (await batchGet([range]))[range] ?? [];
  const out: QueueRow[] = [];
  grid.slice(1).forEach((row, i) => {
    if (!cell(row, COL.requestId) || isExampleRow(row)) return;
    out.push({
      sheetRow: i + 4,
      requestId: cell(row, COL.requestId),
      requestedAt: cell(row, COL.requestedAt),
      requestedBy: cell(row, COL.requestedBy),
      month: cell(row, COL.month),
      status: cell(row, COL.status).toUpperCase(),
      driveLink: cell(row, COL.driveLink),
      completedAt: cell(row, COL.completedAt),
      type: typeOf(cell(row, COL.type)),
      lastTouched: cell(row, COL.lastTouched),
      errorNotes: cell(row, COL.errorNotes),
    });
  });
  return out;
}

const STALE_MS = 90 * 60 * 1000;

/** PENDING rows first, then PROCESSING rows abandoned for more than 90 minutes. */
export function claimable(rows: QueueRow[], now = Date.now()): QueueRow[] {
  const pending = rows.filter((r) => r.status === "PENDING");
  const stale = rows.filter((r) => {
    if (r.status !== "PROCESSING") return false;
    const touched = parseStamp(r.lastTouched) ?? parseStamp(r.requestedAt);
    return touched === null || now - touched > STALE_MS;
  });
  return [...pending, ...stale];
}

export async function markProcessing(row: QueueRow) {
  await batchUpdateValues([
    { range: `Control!E${row.sheetRow}`, values: [["PROCESSING"]] },
    { range: `Control!I${row.sheetRow}`, values: [[utcStamp()]] },
  ]);
}

export async function markDone(row: QueueRow, driveLink?: string, note = "") {
  const now = utcStamp();
  const writes = [
    { range: `Control!E${row.sheetRow}`, values: [["DONE"]] },
    { range: `Control!G${row.sheetRow}`, values: [[now]] },
    { range: `Control!I${row.sheetRow}`, values: [[now]] },
    { range: `Control!J${row.sheetRow}`, values: [[note]] },
  ];
  if (driveLink) writes.push({ range: `Control!F${row.sheetRow}`, values: [[driveLink]] });
  await batchUpdateValues(writes);
}

export async function markFailed(row: QueueRow, reason: string) {
  const now = utcStamp();
  await batchUpdateValues([
    { range: `Control!E${row.sheetRow}`, values: [["FAILED"]] },
    { range: `Control!I${row.sheetRow}`, values: [[now]] },
    { range: `Control!J${row.sheetRow}`, values: [[reason.slice(0, 480)]] },
  ]);
}

/** Small key/value tab used to remember once-per-month work. */
export async function readState(key: string): Promise<string | null> {
  const range = "Automation State!A2:C200";
  try {
    const grid = (await batchGet([range]))[range] ?? [];
    const found = grid.find((r) => cell(r, 0) === key);
    return found ? cell(found, 1) : null;
  } catch {
    return null;
  }
}

export async function writeState(key: string, value: string) {
  const { ensureTab, appendRows } = await import("../sheets.server");
  await ensureTab("Automation State", ["Key", "Value", "Updated At (UTC)"]);
  const range = "Automation State!A2:C200";
  const grid = (await batchGet([range]))[range] ?? [];
  const idx = grid.findIndex((r) => cell(r, 0) === key);
  if (idx >= 0) {
    await updateValues(`Automation State!A${idx + 2}:C${idx + 2}`, [[key, value, utcStamp()]]);
  } else {
    await appendRows("Automation State!A:C", [[key, value, utcStamp()]]);
  }
}