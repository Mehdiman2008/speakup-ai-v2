/* ============================================================================
   modelRouter.ts

   Final Architecture:

   Realistic:
     All outputs -> GPT-4o-mini

   Coach Silver:
     Roleplay -> GPT-4o
     Natural Version -> GPT-4o
     Coach Note -> GPT-4o
     Options -> GPT-4o
     Everything else -> GPT-4o-mini

   Coach Titanium:
     Roleplay -> Claude Sonnet
     Natural Version -> GPT-4o
     Coach Note -> GPT-4o
     Options -> GPT-4o
     Everything else -> GPT-4o-mini

   Coach Gold:
     Roleplay -> GPT-5.5
     Natural Version -> GPT-4o
     Coach Note -> GPT-4o
     Options -> GPT-4o
     Everything else -> GPT-4o-mini
============================================================================ */

import type { ModeId, OutputType } from "./types";
import type { ModelTarget } from "./providers";

const env = (name: string, fallback: string) =>
  process.env[name] || fallback;

export const OPENAI_FALLBACK_MODEL = () =>
  env("OPENAI_FALLBACK_MODEL", "gpt-4o");

const M = {
  gpt4oMini: (): ModelTarget => ({
    provider: "openai",
    model: env("GPT4O_MINI_MODEL", "gpt-4o-mini"),
  }),

  gpt4o: (): ModelTarget => ({
    provider: "openai",
    model: env("GPT4O_MODEL", "gpt-4o"),
  }),

  claudeSonnet: (): ModelTarget => ({
    provider: "claude",
    model: env("CLAUDE_SONNET_MODEL", "claude-sonnet-4-6"),
  }),

  gpt55: (): ModelTarget => ({
    provider: "openai",
    model: env("GPT55_MODEL", "gpt-5.5"),
  }),
};

type Routes = Record<OutputType, () => ModelTarget>;

const allMini: Routes = {
  roleplay: M.gpt4oMini,
  grammarScore: M.gpt4oMini,
  naturalnessScore: M.gpt4oMini,
  correction: M.gpt4oMini,
  naturalVersion: M.gpt4oMini,
  coachNote: M.gpt4oMini,
  options: M.gpt4oMini,
  endFeedback: M.gpt4oMini,
  help: M.gpt4oMini,
};

const coachRoutes = (roleplay: () => ModelTarget): Routes => ({
  roleplay,

  grammarScore: M.gpt4oMini,
  naturalnessScore: M.gpt4oMini,
  correction: M.gpt4oMini,
  endFeedback: M.gpt4oMini,

  naturalVersion: M.gpt4o,
  coachNote: M.gpt4o,
  options: M.gpt4o,
  help: M.gpt4o,
});

export const MODEL_ROUTER: Record<ModeId, Routes> = {
  realistic: allMini,

  silver: coachRoutes(M.gpt4o),

  titanium: coachRoutes(M.claudeSonnet),

  gold: coachRoutes(M.gpt55),
};

export function routeFor(
  mode: ModeId,
  output: OutputType
): ModelTarget {
  const routes = MODEL_ROUTER[mode] || MODEL_ROUTER.realistic;
  return (routes[output] || M.gpt4oMini)();
}

export const isCoachMode = (mode: ModeId) =>
  mode !== "realistic";