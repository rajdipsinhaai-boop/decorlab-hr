import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAttendanceFile } from "@/lib/attendance/parse.server";
import type { ParsedDay } from "@/lib/attendance/types";

const load = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe("COSEC attendance report parsing (September 2026 sample)", () => {
  it("parses every person-day from the Excel export", async () => {
    const r = await parseAttendanceFile(load("cosec-sept-2026.xlsx"));
    expect(r.format).toBe("xlsx");
    expect(r.periodStart).toBe("2026-09-01");
    expect(r.periodEnd).toBe("2026-09-30");
    expect(r.days).toHaveLength(390); // 13 people x 30 days
    expect(r.people).toHaveLength(13);
    expect(r.warnings).toEqual([]);

    const ranjan = r.days.find((d) => d.cosecId === "D100" && d.workDate === "2026-09-01")!;
    expect(ranjan).toMatchObject({
      name: "RANJAN MAITY",
      shift: "ES",
      inAt: "2026-09-01T12:10:59",
      outAt: "2026-09-01T18:19:55",
      firstHalf: "AB",
      secondHalf: "PR",
      earlyOutMin: 71,
      workMin: 6 * 60 + 9,
      manualEntry: false,
    });
    const bhavana = r.days.find((d) => d.cosecId === "D109" && d.workDate === "2026-09-01")!;
    expect(bhavana).toMatchObject({ manualEntry: true, reason: "Out time missing", workMin: 530 });
  });

  it("keeps night-shift punches on their real dates", async () => {
    const r = await parseAttendanceFile(load("cosec-sept-2026.xlsx"));
    const night = r.days.find((d) => d.cosecId === "D100" && d.workDate === "2026-09-04")!;
    expect(night.inAt).toBe("2026-09-04T19:00:12");
    expect(night.outAt).toBe("2026-09-05T06:29:12");
    expect(night.workMin).toBe(11 * 60 + 29);
  });

  it("parses the same report from the PDF with identical results (minute precision)", async () => {
    const x = await parseAttendanceFile(load("cosec-sept-2026.xlsx"));
    const p = await parseAttendanceFile(load("cosec-sept-2026.pdf"));
    expect(p.format).toBe("pdf");
    expect(p.periodStart).toBe(x.periodStart);
    expect(p.periodEnd).toBe(x.periodEnd);
    expect(p.days).toHaveLength(x.days.length);
    expect(p.people.map((q) => [q.cosecId, q.name, q.days])).toEqual(
      x.people.map((q) => [q.cosecId, q.name, q.days]),
    );

    const minute = (v: string | null) => (v ? v.slice(0, 16) : null);
    const mismatches: string[] = [];
    for (const xd of x.days) {
      const pd = p.days.find((d) => d.cosecId === xd.cosecId && d.workDate === xd.workDate)!;
      const diff = (field: keyof ParsedDay, a: unknown, b: unknown) => {
        if (a !== b) mismatches.push(`${xd.workDate} ${xd.cosecId} ${field}: xlsx=${String(a)} pdf=${String(b)}`);
      };
      diff("name", xd.name, pd.name);
      diff("shift", xd.shift, pd.shift);
      diff("firstHalf", xd.firstHalf, pd.firstHalf);
      diff("secondHalf", xd.secondHalf, pd.secondHalf);
      diff("lateInMin", xd.lateInMin, pd.lateInMin);
      diff("earlyOutMin", xd.earlyOutMin, pd.earlyOutMin);
      diff("workMin", xd.workMin, pd.workMin);
      diff("manualEntry", xd.manualEntry, pd.manualEntry);
      diff("reason", xd.reason, pd.reason);
      for (const k of ["inAt", "outAt", "in2At", "out2At"] as const) diff(k, minute(xd[k]), minute(pd[k]));
    }
    // The PDF prints clock times with no date, so a punch that belongs to the previous evening
    // (night shift started before midnight) is placed on the row's own date. Two rows in this sample.
    expect(mismatches).toEqual([
      "2026-09-11 D102 inAt: xlsx=2026-09-10T19:10 pdf=2026-09-11T19:10",
      "2026-09-11 D102 outAt: xlsx=2026-09-11T10:16 pdf=2026-09-12T10:16",
      "2026-09-11 D102 in2At: xlsx=2026-09-11T21:16 pdf=2026-09-12T21:16",
      "2026-09-27 D112 inAt: xlsx=2026-09-26T23:54 pdf=2026-09-27T23:54",
    ]);
  });

  it("rejects files that are not the attendance report", async () => {
    await expect(parseAttendanceFile(new TextEncoder().encode("hello,world"))).rejects.toThrow(/PDF or an Excel/);
  });
});
