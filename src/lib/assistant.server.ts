/** Server-only, read-only HR assistant backed by an optional OpenAI-compatible provider. */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { loadDashboard } from "./hr.server";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

function compactContext(data: Awaited<ReturnType<typeof loadDashboard>>) {
  return {
    month: data.month,
    targetHours: data.targetHours,
    scheduledStart: data.scheduledStart,
    ragBands: { RED: "<60%", YELLOW: "60-75%", GREEN: ">=75%" },
    employees: data.employees.map((e) => ({
      name: e.name,
      role: e.role,
      department: e.department,
      manager: e.manager,
      score: e.score,
      rag: e.rag,
      rankInRole: e.rankInRole,
      overallRank: e.overallRank,
      breakdown: e.breakdown,
      criteria: e.criteria,
      note: e.note,
      presentDays: e.presentDays,
      absentDays: e.absentDays,
      avgHours: e.avgHours,
      punctualityDeviation: e.punctualityDeviation,
    })),
  };
}

export async function answerQuestion(
  question: string,
  history: { role: string; content: string }[],
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "The assistant is not configured. Set OPENAI_API_KEY on the server to enable it.",
    );
  }

  const data = await loadDashboard();
  const system = [
    "You are the Decorlab HR analytics assistant. Answer questions about the team using ONLY the JSON data provided below.",
    "You are strictly read-only: you cannot edit the spreadsheet, upload files, or trigger report generation. If asked to do any of those, say so and point the user to the dashboard buttons.",
    "If the data does not contain the answer, say plainly that it is not available in the current sheet data instead of guessing.",
    "Be concise, plain-language and specific with numbers. RAG bands: RED below 60%, YELLOW 60-75%, GREEN 75% and above.",
    `DATA: ${JSON.stringify(compactContext(data))}`,
  ].join("\n\n");

  const messages = [
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: question },
  ];

  const provider = createOpenAICompatible({
    name: "openai-compatible",
    baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    apiKey,
  });

  try {
    const result = await generateText({
      model: provider(MODEL),
      system,
      messages,
      temperature: 0.3,
    });
    return result.text.trim() || "I couldn't produce an answer for that.";
  } catch (error) {
    console.error("OpenAI-compatible assistant error:", error);
    throw new Error("The assistant could not answer right now. Please try again in a moment.");
  }
}
