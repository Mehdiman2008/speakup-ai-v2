import { NextRequest } from "next/server";
import { buildHelpPrompt } from "@/lib/prompts";
import { callModel } from "@/lib/providers";
import { routeFor } from "@/lib/modelRouter";
import type { ChatMessage, ModeId, Scenario } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request body." }, { status: 200 });
  }

  const messages: ChatMessage[] = body.messages || [];
  const scenario: Partial<Scenario> | undefined = body.scenario;
  const mode: ModeId = body.mode || "silver"; // help quality follows current tier

  try {
    const reply = await callModel(routeFor(mode, "help"), {
      system: buildHelpPrompt(scenario),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      maxTokens: 800,
      temperature: 0.5,
    });
    return Response.json({ reply: reply || "…" });
  } catch (e: any) {
    return Response.json({ error: "Help request failed: " + String(e?.message || e) }, { status: 200 });
  }
}
