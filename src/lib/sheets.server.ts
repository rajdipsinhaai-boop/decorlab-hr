/**
 * Server-only Google Sheets access. Credentials never leave the server:
 * requests are proxied through the Lovable connector gateway.
 */
const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";

export const SPREADSHEET_ID = "11gz8_k0o12efp-Mh2rhQZGCOl0ZcksgEDpo0QpqLNCs";

/** Scheduled office start time used for punctuality deviation (minutes from midnight). */
export const SCHEDULED_START_MINUTES = 10 * 60;

function authHeaders() {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connectionKey = process.env["GOOGLE_SHEETS_API_KEY"];
  if (!lovableKey || !connectionKey) {
    throw new Error("Google Sheets connection is not configured on the server.");
  }
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connectionKey,
  };
}

export type Grid = string[][];

async function sheetsFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Sheets request failed [${res.status}] ${path}: ${body}`);
    throw new Error(`Google Sheets request failed [${res.status}]: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<any>;
}

export async function batchGet(ranges: string[]): Promise<Record<string, Grid>> {
  const qs = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
  const res = await fetch(`${GATEWAY}/spreadsheets/${SPREADSHEET_ID}/values:batchGet?${qs}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Sheets read failed [${res.status}]: ${body}`);
    throw new Error(`Could not read the HR spreadsheet [${res.status}]`);
  }
  const json = (await res.json()) as {
    valueRanges?: { range: string; values?: Grid }[];
  };
  const out: Record<string, Grid> = {};
  (json.valueRanges ?? []).forEach((vr, i) => {
    out[ranges[i]!] = vr.values ?? [];
  });
  return out;
}

export async function appendRow(range: string, row: (string | number)[]) {
  const res = await fetch(
    `${GATEWAY}/spreadsheets/${SPREADSHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ values: [row] }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    console.error(`Sheets append failed [${res.status}]: ${body}`);
    throw new Error(`Could not queue the report request [${res.status}]`);
  }
  return res.json();
}

/** Targeted in-place write of a single range. Never replaces the file. */
export async function updateValues(range: string, values: (string | number)[][]) {
  return sheetsFetch(
    `/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ range, majorDimension: "ROWS", values }),
    },
  );
}

/** Targeted in-place write of several ranges in one call. */
export async function batchUpdateValues(entries: { range: string; values: (string | number)[][] }[]) {
  if (!entries.length) return null;
  return sheetsFetch(`/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: entries }),
  });
}

export async function getSheetTitles(): Promise<string[]> {
  const json = await sheetsFetch(
    `/spreadsheets/${SPREADSHEET_ID}?fields=${encodeURIComponent("sheets.properties.title")}`,
  );
  return (json.sheets ?? []).map((s: any) => s.properties?.title as string).filter(Boolean);
}

/** Adds a tab (with a header row) to the existing spreadsheet when it is missing. */
export async function ensureTab(title: string, headers: string[]): Promise<boolean> {
  const titles = await getSheetTitles();
  if (titles.includes(title)) return false;
  await sheetsFetch(`/spreadsheets/${SPREADSHEET_ID}:batchUpdate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  await updateValues(`${title}!A1`, [headers]);
  return true;
}

/** Appends rows to the end of a tab without touching earlier rows. */
export async function appendRows(range: string, rows: (string | number)[][]) {
  if (!rows.length) return null;
  return sheetsFetch(
    `/spreadsheets/${SPREADSHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: rows }),
    },
  );
}