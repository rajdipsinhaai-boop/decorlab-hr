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