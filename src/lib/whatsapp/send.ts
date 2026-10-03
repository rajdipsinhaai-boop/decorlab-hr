/** GrowBro public WhatsApp API: template messages. Pure helpers, no I/O of their own except `fetch`. */

export interface WhatsAppConfig {
  clientId: string;
  clientSecret: string;
  aiId: string;
  template: string;
  language: string;
  /** false = dry run: nothing is sent and nothing is recorded as sent. */
  enabled: boolean;
  /** When set, every message goes to this number instead (for testing). */
  testTo: string | null;
}

export const API_URL = "https://growbro-backend.fly.dev/api/public/v1/whatsapp/messages/template";

const digits = (s: string) => s.replace(/\D+/g, "");

/** "+91 90512 92971" -> "919051292971"; a bare 10-digit Indian number gets 91 in front. Null if unusable. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const d = digits(raw ?? "");
  if (d.length === 10) return `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): WhatsAppConfig | null {
  const clientId = env["GROWBRO_CLIENT_ID"];
  const clientSecret = env["GROWBRO_CLIENT_SECRET"];
  const aiId = env["GROWBRO_AI_ID"];
  if (!clientId || !clientSecret || !aiId) return null;
  return {
    clientId,
    clientSecret,
    aiId,
    template: env["WHATSAPP_TEMPLATE_NAME"] || "monthly_report_card",
    language: env["WHATSAPP_TEMPLATE_LANG"] || "en",
    enabled: ["1", "true", "yes", "on"].includes((env["WHATSAPP_SEND_ENABLED"] ?? "").trim().toLowerCase()),
    testTo: normalizePhone(env["WHATSAPP_TEST_TO"]),
  };
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * Template components for monthly_report_card: the PDF as the document header, then the body
 * variables {{1}} = first name, {{2}} = month label.
 */
export function reportComponents(args: { name: string; month: string; pdfUrl: string; filename: string }) {
  return [
    {
      type: "header",
      parameters: [{ type: "document", document: { link: args.pdfUrl, filename: args.filename } }],
    },
    {
      type: "body",
      parameters: [
        { type: "text", text: firstName(args.name) },
        { type: "text", text: args.month },
      ],
    },
  ];
}

export async function sendTemplate(
  cfg: WhatsAppConfig,
  args: { to: string; components: unknown[]; idempotencyKey: string },
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "X-Client-Id": cfg.clientId,
      "X-Client-Secret": cfg.clientSecret,
      "Content-Type": "application/json",
      "Idempotency-Key": args.idempotencyKey,
    },
    body: JSON.stringify({
      ai_id: cfg.aiId,
      to: cfg.testTo ?? args.to,
      template_name: cfg.template,
      language: cfg.language,
      components: args.components,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 500) };
}
