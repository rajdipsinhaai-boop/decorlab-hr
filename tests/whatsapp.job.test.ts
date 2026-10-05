import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The WhatsApp job end to end against an in-memory Supabase and a fake GrowBro API: what goes to whom
 * in test mode, in real mode and in dry-run, and what is (not) recorded as sent.
 */
interface Delivery {
  month_key: string;
  employee_id: string;
  status: string;
  error: string | null;
  to_number: string | null;
}
const EMPLOYEES = [
  { id: "E1", name: "Bhavana Agarwal", phone: "+91 9051292971", status: "Active" },
  { id: "E2", name: "Asif Ali Khan", phone: "+91 8017200790", status: "Active" },
  { id: "E3", name: "No Phone", phone: null, status: "Active" },
  { id: "E4", name: "Gone", phone: "+91 9999999999", status: "Inactive" },
];
const state = { deliveries: [] as Delivery[], files: new Set<string>() };

vi.mock("@/integrations/supabase/client.server", () => {
  const table = (name: string) => {
    let filters: [string, string][] = [];
    const api: any = {
      select: () => api,
      order: () => Promise.resolve({ data: name === "employees" ? EMPLOYEES : [], error: null }),
      eq: (col: string, val: string) => {
        filters.push([col, val]);
        return api;
      },
      then: (resolve: (v: unknown) => void) => {
        const rows = state.deliveries.filter((d) => filters.every(([c, v]) => (d as any)[c] === v));
        resolve({ data: rows, error: null });
      },
      upsert: (row: Delivery) => {
        state.deliveries = state.deliveries.filter(
          (d) => !(d.month_key === row.month_key && d.employee_id === row.employee_id),
        );
        state.deliveries.push(row);
        return Promise.resolve({ error: null });
      },
    };
    return api;
  };
  return {
    supabaseAdmin: {
      from: (name: string) => table(name),
      storage: {
        from: () => ({
          exists: (path: string) => Promise.resolve({ data: state.files.has(path), error: null }),
          createSignedUrl: (path: string) => Promise.resolve({ data: { signedUrl: `https://files.test/${path}?t=1` }, error: null }),
        }),
      },
    },
  };
});

const sent: { to: string; template: string; key: string; header: string; body: string[] }[] = [];
beforeEach(() => {
  sent.length = 0;
  state.deliveries = [];
  state.files = new Set(["2026-09/E1.pdf", "2026-09/E2.pdf"]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: any) => {
      const b = JSON.parse(init.body);
      sent.push({
        to: b.to,
        template: b.template_name,
        key: init.headers["Idempotency-Key"],
        header: b.components[0].parameters[0].document.link,
        body: b.components[1].parameters.map((p: any) => p.text),
      });
      return { ok: true, status: 200, text: async () => '{"success":true}' };
    }),
  );
  process.env["GROWBRO_CLIENT_ID"] = "id";
  process.env["GROWBRO_CLIENT_SECRET"] = "secret";
  process.env["GROWBRO_AI_ID"] = "ai";
  process.env["WHATSAPP_SEND_ENABLED"] = "true";
  delete process.env["WHATSAPP_TEST_TO"];
});

const run = async () => {
  const { runReportWhatsApp } = await import("@/lib/whatsapp/report-whatsapp.server");
  return runReportWhatsApp({ id: "j", type: "report.whatsapp", payload: { monthKey: "2026-09" } } as never);
};
const status = (id: string) => state.deliveries.find((d) => d.employee_id === id)?.status;

describe("WhatsApp report job", () => {
  it("test mode: everything goes to the test number, is marked Test only, and never blocks the real send", async () => {
    process.env["WHATSAPP_TEST_TO"] = "+91 93047 80181";
    await expect(run()).rejects.toThrow(/failed for 1/); // E3 has no phone; E4 is inactive and skipped
    expect(sent.map((s) => s.to)).toEqual(["919304780181", "919304780181"]); // not the employees' own numbers
    expect(sent.map((s) => s.body[0])).toEqual(["Bhavana", "Asif"]); // still personalised
    expect(sent[0]!.key).toContain("report-test-"); // never uses the real send's idempotency key
    expect(status("E1")).toBe("test");
    expect(status("E2")).toBe("test");
    expect(state.deliveries.some((d) => d.status === "sent")).toBe(false);

    // switch test mode off: the real send must go to everyone again, to their own numbers
    delete process.env["WHATSAPP_TEST_TO"];
    sent.length = 0;
    await expect(run()).rejects.toThrow(/failed for 1/);
    expect(sent.map((s) => s.to)).toEqual(["919051292971", "918017200790"]);
    expect(sent[0]!.key).toBe("report-2026-09-E1");
    expect(status("E1")).toBe("sent");
  });

  it("real mode: sends the stored PDF link and month, and a retry skips anyone already sent", async () => {
    await expect(run()).rejects.toThrow(/failed for 1/);
    expect(sent[0]).toMatchObject({
      template: "monthly_report_card",
      header: "https://files.test/2026-09/E1.pdf?t=1",
      body: ["Bhavana", "September 2026"],
    });
    expect(sent).toHaveLength(2);
    sent.length = 0;
    await expect(run()).rejects.toThrow(/failed for 1/);
    expect(sent).toHaveLength(0); // E1 and E2 already sent: nobody is messaged twice
  });

  it("a person with no stored PDF is recorded as failed and nothing is sent for them", async () => {
    state.files.delete("2026-09/E2.pdf");
    await expect(run()).rejects.toThrow(/failed for 2/);
    expect(sent.map((s) => s.body[0])).toEqual(["Bhavana"]);
    expect(status("E2")).toBe("failed");
  });

  it("dry run (sending off): nothing is sent and nothing is marked sent", async () => {
    process.env["WHATSAPP_SEND_ENABLED"] = "false";
    await expect(run()).rejects.toThrow(/failed for 1/);
    expect(sent).toHaveLength(0);
    expect(state.deliveries.some((d) => d.status === "sent" || d.status === "test")).toBe(false);
  });
});
