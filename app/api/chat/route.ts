import { NextRequest } from "next/server";
import type { ChatMessage, ModeId, Scenario } from "@/lib/types";
import { runTurn, runOptions, runEndFeedback, runShadowing } from "@/lib/orchestrator";

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
  const scenario: Partial<Scenario> = body.scenario || {};
  const mode: ModeId = body.mode || "realistic";

  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content?.trim() || "";

  try {
    let reply: string;

    if (lastUser === "/options") {
      reply = await runOptions(scenario, mode, messages);
    } else if (lastUser === "/end") {
      reply = await runEndFeedback(scenario, mode, messages);
    } else if (lastUser === "/shadowing") {
      reply = await runShadowing(scenario, mode, messages);
    } else if (lastUser === "/harder" || lastUser === "/easier") {
      // Difficulty hints are folded into the next normal turn; acknowledge briefly.
      reply = await runTurn(scenario, mode, messages);
    } else {
      reply = await runTurn(scenario, mode, messages);
    }

    if (!reply || !reply.trim()) {
      return Response.json({ error: "Empty reply from model. Check provider keys/quota." }, { status: 200 });
    }
    console.log(`[chat] mode=${mode} cmd=${lastUser.startsWith("/") ? lastUser : "-"} len=${reply.length}`);
    return Response.json({ reply });
  } catch (e: any) {
    const msg = String(e?.message || e);
    console.error("[chat] error:", msg);
    return Response.json({ error: "Model call failed: " + msg }, { status: 200 });
  }
}
