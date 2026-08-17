import { batchGet, getTitlesOf, getValuesOf, updateValues } from "../sheets.server";
import { findFolder, listFolderFiles } from "../drive.server";
import { findCol, headerIndexOf } from "../csv.server";
import { readState, writeState } from "./control.server";

const EA_NAME = "Priyanka Dalapati";
const FOLDER = "Decorlab Folowups"; // real folder name, typo included
const cell = (row: string[] | undefined, i: number) => (i >= 0 ? (row?.[i] ?? "").toString().trim() : "");

function parseDate(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(t);
  if (dmy) {
    const year = dmy[3]!.length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return Date.UTC(year, Number(dmy[2]) - 1, Number(dmy[1]));
  }
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

interface Tally {
  active: number;
  flags: number;
  delayed: number;
  unresolvedDelayed: number;
  stale: number;
  sheets: number;
}

function scoreFrom(t: Tally): number {
  if (!t.active) return 3;
  if (!t.flags) return 5;
  const ratio = t.flags / t.active;
  if (t.unresolvedDelayed === 0 && t.stale === 0) return 4;
  if (ratio > 0.5 || (t.stale > 0 && t.stale >= t.active * 0.5)) return t.flags > t.active * 0.7 ? 1 : 2;
  return 3;
}

/** Scores Priyanka's follow-up discipline once per review month. */
export async function scoreFollowUps(): Promise<string | null> {
  const eaRange = "EA KRA!A2:Q200";
  const ea = (await batchGet([eaRange]))[eaRange] ?? [];
  const reviewMonth = cell(ea[0], 1);
  if (!reviewMonth) return null;

  const stateKey = "followup-score";
  if ((await readState(stateKey)) === reviewMonth) return null;

  const folderId = await findFolder(FOLDER);
  if (!folderId) return null;

  const files = (await listFolderFiles(folderId)).filter(
    (f) => f.mimeType === "application/vnd.google-apps.spreadsheet",
  );
  if (!files.length) return null;

  const now = Date.now();
  const tally: Tally = { active: 0, flags: 0, delayed: 0, unresolvedDelayed: 0, stale: 0, sheets: 0 };

  for (const file of files) {
    let titles: string[] = [];
    try {
      titles = await getTitlesOf(file.id);
    } catch {
      continue;
    }
    // Legacy per-floor tab layouts are excluded from scoring.
    if (titles.length > 1 && titles.some((t) => /floor|ground|basement|terrace/i.test(t))) continue;

    const grid = await getValuesOf(file.id, `${titles[0]}!A1:Z500`);
    const headerIdx = grid.findIndex((r) => /status/i.test(r.join(" ")) && /follow.?up|work|item/i.test(r.join(" ")));
    if (headerIdx < 0) continue;
    const map = headerIndexOf(grid[headerIdx]!);
    const i = {
      status: findCol(map, "status"),
      next: findCol(map, "next follow-up date", "next follow"),
      notes: findCol(map, "notes"),
    };
    if (i.status < 0) continue;
    tally.sheets++;

    for (const row of grid.slice(headerIdx + 1)) {
      const status = cell(row, i.status);
      if (!status || /^not started$/i.test(status)) continue;
      tally.active++;
      const notes = cell(row, i.notes);
      const next = parseDate(cell(row, i.next));
      const isDelayed = /^delayed$/i.test(status);
      const isResolved = /resolved/i.test(status);
      if (isDelayed) tally.delayed++;
      if (isDelayed && !notes) {
        tally.flags++;
        tally.unresolvedDelayed++;
      }
      if (next !== null && next < now && /in progress|delayed/i.test(status) && !isResolved) {
        tally.flags++;
      }
      if (next === null && !notes && /in progress|delayed/i.test(status)) {
        tally.flags++;
        tally.stale++;
      }
    }
  }

  // Data does not look like the documented layout — never guess a rating.
  if (!tally.sheets || !tally.active) return null;

  const score = scoreFrom(tally);

  // Locate Priyanka's "Task Follow-up & Coordination" rating cell in EA KRA.
  const headerRow = ea[1] ?? [];
  const map = headerIndexOf(headerRow);
  const iName = findCol(map, "employee name");
  const iParam = findCol(map, "kra parameter");
  const iRating = findCol(map, "rating (1-5)", "rating");
  if (iName < 0 || iParam < 0 || iRating < 0) return null;

  const dataIdx = ea
    .slice(2)
    .findIndex(
      (r) =>
        cell(r, iName).toLowerCase().includes("priyanka") &&
        /task follow.?up/i.test(cell(r, iParam)),
    );
  if (dataIdx < 0) return null;

  const sheetRow = dataIdx + 4; // A2 is Review Month row, A3 header, data from row 4
  const col = String.fromCharCode(65 + iRating);
  await updateValues(`EA KRA!${col}${sheetRow}`, [[score]]);

  // Verify the write landed (and that a neighbouring cell was untouched).
  const verifyRange = `EA KRA!A${sheetRow}:${String.fromCharCode(65 + iRating)}${sheetRow}`;
  const verify = (await batchGet([verifyRange]))[verifyRange]?.[0] ?? [];
  const wrote = cell(verify, iRating);
  const neighbour = cell(verify, iParam);
  if (Number(wrote) !== score || !/task follow.?up/i.test(neighbour)) {
    console.error(`Follow-up rating verification failed: got "${wrote}" on row "${neighbour}"`);
    return `followups: verification failed for ${EA_NAME}`;
  }

  await writeState(stateKey, reviewMonth);
  return `followups: ${EA_NAME} scored ${score}/5 across ${tally.sheets} site sheets (${tally.flags} flags / ${tally.active} active rows)`;
}