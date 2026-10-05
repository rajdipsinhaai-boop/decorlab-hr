/** Server-only, read-only HR assistant backed by an optional OpenAI-compatible provider. */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { loadDashboard } from "./hr.server";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-6-luna";

/** How scores are built, in plain words, so the assistant can explain a number without guessing. */
const HOW_SCORES_WORK = [
  "Final score = weighted parts. Supervisors: attendance 30%, DPR 50%, system work feedback 20%. Designers: attendance 25%, coordination 40%, feedback 35% (no coordination data: attendance 50%, feedback 50%). EA: attendance 60%, feedback 40%.",
  "Attendance % = hours worked / (working days x 8.5h), capped at 100%. Working days exclude Sundays, official holidays and that person's own leave days. Arriving late costs nothing if the hours are made up; overtime counts toward the hours. There is no half day: fewer hours just means a lower percentage.",
  "Visibility rule: attendance is multiplied by (days with a real update / days present). Each person has 2 warnings per calendar year: a month with fewer updates than days present uses one warning and attendance is not reduced; after both are used the reduction applies.",
  "DPR (supervisors) = coverage x 40% + quality x 60%. Designer coordination comes from the WhatsApp chat review where available (overall/5 x 100).",
  "RAG: GREEN 75% and above, YELLOW 60-75%, RED below 60%.",
].join(" ");

export function compactContext(data: Awaited<ReturnType<typeof loadDashboard>>) {
  return {
    month: data.month,
    locked: Boolean(data.locked),
    targetHours: data.targetHours,
    ragBands: { RED: "<60%", YELLOW: "60-75%", GREEN: ">=75%" },
    howScoresWork: HOW_SCORES_WORK,
    employees: data.employees.map((e) => ({
      name: e.name,
      role: e.role,
      score: e.score,
      rag: e.rag,
      rankInRole: e.rankInRole,
      overallRank: e.overallRank,
      // each part of the score with its own explanation (hours, warnings used, coordination, DPR...)
      parts: (e.card?.components ?? []).map((c) => ({ part: c.label, weight: c.weight, score: c.score, explanation: c.note })),
      whyThisScore: e.card?.why ?? [],
      whatToImprove: e.card?.improve ?? [],
      stillMissing: e.card?.pending ?? [],
      kraRatings: e.criteria,
      presentDays: e.presentDays,
      leaveDays: e.leaveDays,
      absentDays: e.absentDays,
      hoursWorked: e.totalHours,
      avgHoursPerDay: e.avgHours,
      updateDiscipline: e.filingDiscipline,
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
    "You are the Decorlab HR analytics assistant. Answer questions about this month's grading using ONLY the JSON data provided below.",
    "You are strictly read-only: you cannot edit the spreadsheet, upload files, or trigger report generation. If asked to do any of those, say so and point the user to the dashboard buttons.",
    "If the data does not contain the answer, say plainly that it is not available in the current sheet data instead of guessing.",
    "Keep every answer short and simple: a sentence or two, or a few short bullets, with the actual numbers. Explain a score using the person's own parts, explanations and howScoresWork. RAG bands: RED below 60%, YELLOW 60-75%, GREEN 75% and above.",
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
    });
    return result.text.trim() || "I couldn't produce an answer for that.";
  } catch (error) {
    console.error("OpenAI-compatible assistant error:", error);
    throw new Error("The assistant could not answer right now. Please try again in a moment.");
  }
}
