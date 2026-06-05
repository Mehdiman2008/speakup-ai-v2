/* ============================================================================
   orchestrator.ts — implements the mandatory multi-call architecture.

   Step 1: roleplay reply from the tier's premium model.
   Step 2: coaching outputs from their assigned models (in parallel).
   Step 3: combine into the existing block format the UI already parses
           ([FEEDBACK] / [ROLEPLAY] / [COACHNOTE]).

   Realistic mode = roleplay only (no per-turn coaching), everything on Gemini.
============================================================================ */

import type { ChatMessage, ModeId, Scenario } from "./types";
import { routeFor, isCoachMode } from "./modelRouter";
import { callModel } from "./providers";
import {
  buildRoleplaySystem,
  buildAnalysisSystem,
  buildNaturalVersionSystem,
  buildCoachNoteSystem,
} from "./prompts";

type Msgs = { role: "user" | "assistant"; content: string }[];

function lastUserText(messages: ChatMessage[]): string {
  return [...messages].reverse().find((m) => m.role === "user")?.content?.trim() || "";
}

export async function runTurn(
  scenario: Partial<Scenario>,
  mode: ModeId,
  messages: ChatMessage[]
): Promise<string> {
  const history: Msgs = messages.map((m) => ({ role: m.role, content: m.content }));

  // ---- Step 1: roleplay (premium model for the tier) ----
  const roleplay = await callModel(routeFor(mode, "roleplay"), {
    system: buildRoleplaySystem(scenario, mode),
    messages: history,
    maxTokens: 400,
    temperature: 0.85,
  });

  // Realistic: roleplay only, no coaching blocks.
  if (!isCoachMode(mode)) {
    return `[ROLEPLAY]\n${roleplay.trim()}\n[/ROLEPLAY]`;
  }

  // ---- Step 2: coaching outputs in parallel ----
  const userMsg = lastUserText(messages);
  const analysisMsgs: Msgs = [{ role: "user", content: userMsg }];
  const naturalMsgs: Msgs = [{ role: "user", content: userMsg }];
  // The coach note responds to what the AI just said (the roleplay line).
  const noteMsgs: Msgs = [{ role: "user", content: `${userMsg ? "I said: " + userMsg + ". " : ""}${scenario.aiRole || "They"} just said: "${roleplay.trim()}". Give the coaching note.` }];

  const [analysisRaw, naturalRaw, noteRaw] = await Promise.all([
    callModel(routeFor(mode, "grammarScore"), {
      system: buildAnalysisSystem(scenario),
      messages: analysisMsgs,
      maxTokens: 200,
      temperature: 0.3,
    }).catch(() => ""),
    callModel(routeFor(mode, "naturalVersion"), {
      system: buildNaturalVersionSystem(scenario),
      messages: naturalMsgs,
      maxTokens: 120,
      temperature: 0.6,
    }).catch(() => ""),
    callModel(routeFor(mode, "coachNote"), {
      system: buildCoachNoteSystem(scenario),
      messages: noteMsgs,
      maxTokens: 120,
      temperature: 0.6,
    }).catch(() => ""),
  ]);

  // ---- Step 3: combine into the UI's block format ----
  // analysisRaw already contains the "Grammar: .. | .." line + Correction line.
  const feedback = [
    analysisRaw.trim(),
    naturalRaw.trim() ? `Natural Version: "${stripQuotes(naturalRaw.trim())}"` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const parts = [
    feedback ? `[FEEDBACK]\n${feedback}\n[/FEEDBACK]` : "",
    `[ROLEPLAY]\n${roleplay.trim()}\n[/ROLEPLAY]`,
    noteRaw.trim() ? `[COACHNOTE]\n${stripQuotes(noteRaw.trim())}\n[/COACHNOTE]` : "",
  ].filter(Boolean);

  return parts.join("\n");
}

/* ---- single-output helpers for slash commands ---- */
export async function runOptions(scenario: Partial<Scenario>, mode: ModeId, messages: ChatMessage[]): Promise<string> {
  const { buildOptionsSystem } = await import("./prompts");
  const history: Msgs = messages.map((m) => ({ role: m.role, content: m.content }));
  return callModel(routeFor(mode, "options"), {
    system: buildOptionsSystem(scenario),
    messages: history,
    maxTokens: 400,
    temperature: 0.7,
  });
}

export async function runEndFeedback(scenario: Partial<Scenario>, mode: ModeId, messages: ChatMessage[]): Promise<string> {
  const { buildEndFeedbackSystem } = await import("./prompts");
  const history: Msgs = messages.map((m) => ({ role: m.role, content: m.content }));
  return callModel(routeFor(mode, "endFeedback"), {
    system: buildEndFeedbackSystem(scenario),
    messages: history,
    maxTokens: 1200,
    temperature: 0.5,
  });
}

export async function runShadowing(scenario: Partial<Scenario>, mode: ModeId, messages: ChatMessage[]): Promise<string> {
  const { buildShadowingSystem } = await import("./prompts");
  const history: Msgs = messages.map((m) => ({ role: m.role, content: m.content }));
  // Shadowing uses the tier's premium roleplay model (it reproduces the voice).
  return callModel(routeFor(mode, "roleplay"), {
    system: buildShadowingSystem(scenario),
    messages: history,
    maxTokens: 800,
    temperature: 0.6,
  });
}

function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, "").trim();
}
