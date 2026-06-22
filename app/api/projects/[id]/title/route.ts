import { NextResponse } from "next/server";

import { requireOwnedProject } from "@/lib/auth";
import { updateProject } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const TITLE_MODEL = "claude-haiku-4-5-20251001";
const MAX_TITLE_LEN = 48;
const TITLE_SYSTEM = [
  "You generate a short title for a coding project chat.",
  "Output rules:",
  "- 2 to 5 words, max 40 characters.",
  "- Title Case. No quotes, no punctuation, no trailing period.",
  "- Describe the dApp or feature the user is asking for, not the chat itself.",
  "- Never say Project, Chat, Session, or App by itself.",
  "Return only the title text.",
].join("\n");

export async function POST(req: Request, context: RouteContext) {
  const { id: projectId } = await context.params;
  const owned = await requireOwnedProject(req, projectId);
  if (owned instanceof NextResponse) return owned;

  let body: { prompt?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const prompt = body?.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  if (owned.project.title) {
    return NextResponse.json({ title: owned.project.title, cached: true });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY missing" },
      { status: 500 },
    );
  }

  let title: string;
  try {
    title = await generateTitle(apiKey, prompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  await updateProject(projectId, { title });
  return NextResponse.json({ title });
}

async function generateTitle(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: TITLE_MODEL,
      max_tokens: 40,
      system: TITLE_SYSTEM,
      messages: [{ role: "user", content: prompt.slice(0, 2000) }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const raw =
    data.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join(" ")
      .trim() ?? "";
  return normalizeTitle(raw);
}

function normalizeTitle(raw: string): string {
  let t = raw
    .replace(/[\r\n]+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > MAX_TITLE_LEN) t = t.slice(0, MAX_TITLE_LEN).trim();
  if (!t) t = "New Project";
  return t;
}
