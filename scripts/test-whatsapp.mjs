#!/usr/bin/env node
// Sends ONE test message with the monthly_report_card template to WHATSAPP_TEST_TO.
//   node scripts/test-whatsapp.mjs <public PDF url> [name] [month]
// Reads GROWBRO_CLIENT_ID, GROWBRO_CLIENT_SECRET, GROWBRO_AI_ID and WHATSAPP_TEST_TO from .env.
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const [pdfUrl, name = "Rumman", month = "August 2026"] = process.argv.slice(2);
if (!pdfUrl) {
  console.error("Usage: node scripts/test-whatsapp.mjs <public PDF url> [name] [month]");
  process.exit(1);
}
const to = (process.env.WHATSAPP_TEST_TO ?? "").replace(/\D/g, "");
if (!to) {
  console.error("Set WHATSAPP_TEST_TO in .env");
  process.exit(1);
}
const res = await fetch("https://growbro-backend.fly.dev/api/public/v1/whatsapp/messages/template", {
  method: "POST",
  headers: {
    "X-Client-Id": process.env.GROWBRO_CLIENT_ID,
    "X-Client-Secret": process.env.GROWBRO_CLIENT_SECRET,
    "Content-Type": "application/json",
    "Idempotency-Key": `test-${Date.now()}`,
  },
  body: JSON.stringify({
    ai_id: process.env.GROWBRO_AI_ID,
    to: to.length === 10 ? `91${to}` : to,
    template_name: process.env.WHATSAPP_TEMPLATE_NAME || "monthly_report_card",
    language: process.env.WHATSAPP_TEMPLATE_LANG || "en",
    components: [
      { type: "header", parameters: [{ type: "document", document: { link: pdfUrl, filename: "Test Report Card.pdf" } }] },
      { type: "body", parameters: [{ type: "text", text: name }, { type: "text", text: month }] },
    ],
  }),
});
console.log("HTTP", res.status);
console.log((await res.text()).slice(0, 800));
