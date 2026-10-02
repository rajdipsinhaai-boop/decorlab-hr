import { AttendanceParseError, type ParsedReport } from "./types";
import { parseCosecPdf } from "./parse-pdf.server";
import { parseCosecXlsx } from "./parse-xlsx.server";

export type AttendanceFormat = "pdf" | "xlsx";

/** Decides the format from the file's own bytes; the file name is not trusted. */
export function detectFormat(bytes: Uint8Array): AttendanceFormat | null {
  const head = String.fromCharCode(...bytes.slice(0, 5));
  if (head.startsWith("%PDF")) return "pdf";
  // .xlsx is a zip container ("PK\x03\x04").
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "xlsx";
  return null;
}

export async function parseAttendanceFile(bytes: Uint8Array): Promise<ParsedReport> {
  const format = detectFormat(bytes);
  if (format === "pdf") return parseCosecPdf(bytes);
  if (format === "xlsx") return parseCosecXlsx(bytes);
  throw new AttendanceParseError("Only the attendance report as a PDF or an Excel (.xlsx) file is accepted.");
}
