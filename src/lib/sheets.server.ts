/**
 * Server-only Google Sheets access through the native Google APIs.
 * The service-account credential is read only on the server and never reaches the browser.
 */
import { google, sheets_v4 } from "googleapis";

export const SPREADSHEET_ID =
  process.env.GOOGLE_SHEET_ID ?? "11gz8_k0o12efp-Mh2rhQZGCOl0ZcksgEDpo0QpqLNCs";

/** Scheduled office start time used for punctuality deviation (minutes from midnight). */
export const SCHEDULED_START_MINUTES = 10 * 60;

export type Grid = string[][];

type ServiceAccountJson = {
  client_email: string;
  private_key: string;
};

let sheetsClient: sheets_v4.Sheets | undefined;

function readServiceAccount(): ServiceAccountJson {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ServiceAccountJson>;
      if (parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, "\n"),
        };
      }
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
  }

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (clientEmail && privateKey) {
    return {
      client_email: clientEmail,
      private_key: privateKey.replace(/\\n/g, "\n"),
    };
  }

  throw new Error(
    "Google Sheets is not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON on the server.",
  );
}

function getSheetsClient(): sheets_v4.Sheets {
  if (sheetsClient) return sheetsClient;
  const credentials = readServiceAccount();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

function encodeRange(range: string) {
  return encodeURIComponent(range);
}

export async function batchGet(ranges: string[]): Promise<Record<string, Grid>> {
  if (!ranges.length) return {};
  const response = await getSheetsClient().spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges,
    valueRenderOption: "FORMATTED_VALUE",
  });
  const out: Record<string, Grid> = {};
  (response.data.valueRanges ?? []).forEach((vr, i) => {
    out[ranges[i]!] = (vr.values ?? []) as Grid;
  });
  return out;
}

export async function appendRow(range: string, row: (string | number)[]) {
  const response = await getSheetsClient().spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
  return response.data;
}

/** Targeted in-place write of a single range. Never replaces the file. */
export async function updateValues(
  range: string,
  values: (string | number)[][],
) {
  const response = await getSheetsClient().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { range, majorDimension: "ROWS", values },
  });
  return response.data;
}

/** Targeted in-place write of several ranges in one call. */
export async function batchUpdateValues(
  entries: { range: string; values: (string | number)[][] }[],
) {
  if (!entries.length) return null;
  const response = await getSheetsClient().spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: entries,
    },
  });
  return response.data;
}

export async function getSheetTitles(): Promise<string[]> {
  const response = await getSheetsClient().spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: "sheets.properties.title",
  });
  return (response.data.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
    .filter((title): title is string => Boolean(title));
}

/** Adds a tab (with a header row) to the existing spreadsheet when it is missing. */
export async function ensureTab(title: string, headers: string[]): Promise<boolean> {
  const titles = await getSheetTitles();
  if (titles.includes(title)) return false;
  await getSheetsClient().spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  await updateValues(`${title}!A1`, [headers]);
  return true;
}

/** Appends rows to the end of a tab without touching earlier rows. */
export async function appendRows(
  range: string,
  rows: (string | number)[][],
) {
  if (!rows.length) return null;
  const response = await getSheetsClient().spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
  return response.data;
}

/** Read-only helpers for OTHER spreadsheets (e.g. the site follow-up sheets). */
export async function getTitlesOf(spreadsheetId: string): Promise<string[]> {
  const response = await getSheetsClient().spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  return (response.data.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
    .filter((title): title is string => Boolean(title));
}

export async function getValuesOf(
  spreadsheetId: string,
  range: string,
): Promise<Grid> {
  const response = await getSheetsClient().spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "FORMATTED_VALUE",
  });
  return (response.data.values ?? []) as Grid;
}

void encodeRange;
