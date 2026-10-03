import { describe, expect, it } from "vitest";
import { configFromEnv, normalizePhone, reportComponents } from "@/lib/whatsapp/send";

describe("whatsapp send helpers", () => {
  it("normalises Indian numbers to country code + number", () => {
    expect(normalizePhone("+91 9051292971")).toBe("919051292971");
    expect(normalizePhone("9304780181")).toBe("919304780181");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
  it("builds the document header and the two body variables", () => {
    const c = reportComponents({ name: "Bhavana Agarwal", month: "September 2026", pdfUrl: "https://x/y.pdf", filename: "r.pdf" });
    expect(c[0]).toEqual({ type: "header", parameters: [{ type: "document", document: { link: "https://x/y.pdf", filename: "r.pdf" } }] });
    expect(c[1]).toEqual({ type: "body", parameters: [{ type: "text", text: "Bhavana" }, { type: "text", text: "September 2026" }] });
  });
  it("is off unless configured, and never sends unless explicitly enabled", () => {
    expect(configFromEnv({})).toBeNull();
    const env = { GROWBRO_CLIENT_ID: "a", GROWBRO_CLIENT_SECRET: "b", GROWBRO_AI_ID: "c" };
    expect(configFromEnv(env)).toMatchObject({ enabled: false, template: "monthly_report_card", language: "en", testTo: null });
    expect(configFromEnv({ ...env, WHATSAPP_SEND_ENABLED: "true", WHATSAPP_TEST_TO: "+91 93047 80181" })).toMatchObject({ enabled: true, testTo: "919304780181" });
  });
});
