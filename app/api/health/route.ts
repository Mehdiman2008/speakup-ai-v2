import { NextRequest } from "next/server";
import { providerAvailable } from "@/lib/providers";

export const runtime = "nodejs";

// Visit /api/health to see which providers are configured and whether the
// OpenAI key (used for fallback + voice) works.
export async function GET(_req: NextRequest) {
  const providers = {
    openai: providerAvailable("openai"),
    gemini: providerAvailable("gemini"),
    claude: providerAvailable("claude"),
  };

  const models = {
    GEMINI_MODEL: process.env.GEMINI_MODEL || "(default gemini-1.5-flash)",
    GPT4O_MODEL: process.env.GPT4O_MODEL || "(default gpt-4o)",
    CLAUDE_SONNET_MODEL: process.env.CLAUDE_SONNET_MODEL || "(default claude-sonnet-4-20250514)",
    GPT55_MODEL: process.env.GPT55_MODEL || "(default gpt-4o)",
    OPENAI_FALLBACK_MODEL: process.env.OPENAI_FALLBACK_MODEL || "(default gpt-4o)",
  };

  const key = process.env.OPENAI_API_KEY;
  let openaiChat = "not tested";
  let voiceTts = "not tested";
  let transcription = "not tested";

  if (key) {
    const auth = { Authorization: `Bearer ${key}` };
    const model = process.env.GPT4O_MODEL || process.env.OPENAI_FALLBACK_MODEL || "gpt-4o";
    openaiChat = await probe(async () => {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 5 }),
      });
      return r;
    });
    voiceTts = await probe(async () => {
      const r = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "tts-1", voice: process.env.OPENAI_TTS_VOICE || "onyx", input: "ok" }),
      });
      return r;
    });
    transcription = await probe(async () => {
      const fd = new FormData();
      fd.append("file", new Blob([silentWav()], { type: "audio/wav" }), "ping.wav");
      fd.append("model", "whisper-1");
      const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: auth, body: fd });
      return r;
    });
  }

  return Response.json({
    providersConfigured: providers,
    note: "Modes route to providers per spec. Any provider without a key falls back to OpenAI automatically.",
    envModels: models,
    openai: { chat: openaiChat, voice_tts: voiceTts, transcription },
    ready: providers.openai,
    readyMessage: providers.openai
      ? "OpenAI key present — app works now (premium tiers fall back to OpenAI until Gemini/Claude keys are added)."
      : "No OPENAI_API_KEY — set it in .env.local. It powers fallback, voice, and transcription.",
  });
}

async function probe(fn: () => Promise<Response>): Promise<string> {
  try {
    const r = await fn();
    if (r.ok) return "works";
    const d = await r.json().catch(() => null);
    return "FAILED: " + (d?.error?.message || `HTTP ${r.status}`).slice(0, 200);
  } catch (e: any) {
    return "FAILED: " + String(e?.message || e).slice(0, 200);
  }
}

function silentWav(): ArrayBuffer {
  const sr = 8000, n = 800, ds = n * 2, buf = new ArrayBuffer(44 + ds), dv = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); dv.setUint32(4, 36 + ds, true); w(8, "WAVE"); w(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, "data"); dv.setUint32(40, ds, true);
  return buf;
}
