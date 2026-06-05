/* ============================================================================
   providers.ts — provider adapters with a single shared signature.

   Every provider exposes: complete({ system, messages, maxTokens, temperature })
   -> Promise<string>. No model names are hardcoded here; they come from env via
   modelRouter.ts. If a provider's API key is absent, callModel() automatically
   falls back to OpenAI so the app keeps working until real keys are added.
============================================================================ */

export type Provider = "openai" | "gemini" | "claude";

export interface CompletionRequest {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
  temperature?: number;
}

export interface ModelTarget {
  provider: Provider;
  model: string; // resolved from env in modelRouter
}

function keyFor(provider: Provider): string | undefined {
  switch (provider) {
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "gemini":
      return process.env.GEMINI_API_KEY;
    case "claude":
      return process.env.ANTHROPIC_API_KEY;
  }
}

export function providerAvailable(provider: Provider): boolean {
  return !!keyFor(provider);
}

/* ----------------------------- OpenAI -------------------------------------- */
async function openaiComplete(model: string, req: CompletionRequest): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Connection: "close" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: req.system }, ...req.messages],
      max_completion_tokens: req.maxTokens ?? 1500,
    
      temperature: 1,
    }),
    // @ts-ignore Next.js extended fetch options
    cache: "no-store",
    keepalive: false,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error("OpenAI: " + (data?.error?.message || `HTTP ${res.status}`));
  return (data.choices?.[0]?.message?.content || "").trim();
}

/* ----------------------------- Gemini -------------------------------------- */
async function geminiComplete(model: string, req: CompletionRequest): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");
  // Gemini takes a single contents array; we prextend the system instruction.
  const contents = req.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Connection: "close" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents,
        generationConfig: {
          maxOutputTokens: req.maxTokens ?? 4000,
          temperature: 0.7,
        },
      }),
      // @ts-ignore
      cache: "no-store",
    }
  );
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error("Gemini: " + (data?.error?.message || `HTTP ${res.status}`));
  const text =
    data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
  return text.trim();
  
}

/* ----------------------------- Claude -------------------------------------- */
async function claudeComplete(model: string, req: CompletionRequest): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      Connection: "close",
    },
    body: JSON.stringify({
      model,
      system: req.system,
      messages: req.messages,
      max_tokens: req.maxTokens ?? 1500,
      temperature: req.temperature ?? 0.8,
    }),
    // @ts-ignore
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error("Claude: " + (data?.error?.message || `HTTP ${res.status}`));
  const text = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  return text.trim();
}

/* --------------------------- dispatch + fallback --------------------------- */
import { OPENAI_FALLBACK_MODEL } from "./modelRouter";

export async function callModel(target: ModelTarget, req: CompletionRequest): Promise<string> {
  // If the assigned provider has no key, transparently fall back to OpenAI.
  let { provider, model } = target;
  if (!providerAvailable(provider)) {
    if (provider !== "openai") {
      console.warn(`[router] ${provider} key missing -> falling back to OpenAI for model ${model}`);
    }
    provider = "openai";
    model = OPENAI_FALLBACK_MODEL();
  }

  switch (provider) {
    case "openai":
      return openaiComplete(model, req);
    case "gemini":
      return geminiComplete(model, req);
    case "claude":
      return claudeComplete(model, req);
  }
}
