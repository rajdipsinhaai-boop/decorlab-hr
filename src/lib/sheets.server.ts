import { googleJson } from "./google-auth.server";

export const SPREADSHEET_ID =
  process.env.GOOGLE_SHEET_ID ?? "11gz8_k0o12efp-Mh2rhQZGCOl0ZcksgEDpo0QpqLNCs";

export const SCHEDULED_START_MINUTES = 10 * 60;
export type Grid = string[][];

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

export async function batchGet(ranges: string[]): Promise<Record<string, Grid>> {
  if (!ranges.length) return {};
  const params = new URLSearchParams({
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
  });
  ranges.forEach((range) => params.append("ranges", range));
  const json = await googleJson<{ valueRanges?: { values?: Grid }[] }>(
    `${SHEETS_API}/${SPREADSHEET_ID}/values:batchGet?${params.toString()}`,
  );
  const out: Record<string, Grid> = {};
  (json.valueRanges ?? []).forEach((valueRange, index) => {
    out[ranges[index]!] = valueRange.values ?? [];
  });
  return out;
}

export async function appendRow(range: string, row: (string | number)[]) {
  const url = new URL(`${SHEETS_API}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}:append`);
  url.searchParams.set("valueInputOption", "USER_ENTERED");
  url.searchParams.set("insertDataOption", "INSERT_ROWS");
  return googleJson(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values: [row] }),
  });
}

export async function updateValues(range: string, values: (string | number)[][]) {
  const url = new URL(`${SHEETS_API}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`);
  url.searchParams.set("valueInputOption", "USER_ENTERED");
  return googleJson(url.toString(), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ range, majorDimension: "ROWS", values }),
  });
}

export async function batchUpdateValues(
  entries: { range: string; values: (string | number)[][] }[],
) {
  if (!entries.length) return null;
  return googleJson(`${SHEETS_API}/${SPREADSHEET_ID}/values:batchUpdate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: entries }),
  });
}

export async function getSheetTitles(): Promise<string[]> {
  const params = new URLSearchParams({ fields: "sheets.properties.title" });
  const json = await googleJson<{ sheets?: { properties?: { title?: string } }[] }>(
    `${SHEETS_API}/${SPREADSHEET_ID}?${params.toString()}`,
  );
  return (json.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
    .filter((title): title is string => Boolean(title));
}

export async function ensureTab(title: string, headers: string[]): Promise<boolean> {
  const titles = await getSheetTitles();
  if (titles.includes(title)) return false;
  await googleJson(`${SHEETS_API}/${SPREADSHEET_ID}:batchUpdate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  await updateValues(`${title}!A1`, [headers]);
  return true;
}

export async function appendRows(
  range: string,
  rows: (string | number)[][],
) {
  if (!rows.length) return null;
  const url = new URL(`${SHEETS_API}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}:append`);
  url.searchParams.set("valueInputOption", "USER_ENTERED");
  url.searchParams.set("insertDataOption", "INSERT_ROWS");
  return googleJson(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows }),
  });
}

export async function getTitlesOf(spreadsheetId: string): Promise<string[]> {
  const params = new URLSearchParams({ fields: "sheets.properties.title" });
  const json = await googleJson<{ sheets?: { properties?: { title?: string } }[] }>(
    `${SHEETS_API}/${spreadsheetId}?${params.toString()}`,
  );
  return (json.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
    .filter((title): title is string => Boolean(title));
}

export async function getValuesOf(spreadsheetId: string, range: string): Promise<Grid> {
  const params = new URLSearchParams({ valueRenderOption: "FORMATTED_VALUE" });
  const json = await googleJson<{ values?: Grid }>(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?${params.toString()}`,
  );
  return json.values ?? [];
}
