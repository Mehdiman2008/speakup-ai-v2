import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return Response.json({ error: "OPENAI_API_KEY is not set." }, { status: 200 });
  }

  let text = "";
  try {
    const body = await req.json();
    text = (body?.text || "").toString().trim();
  } catch {
    return Response.json({ error: "Bad request body." }, { status: 200 });
  }
  if (!text) {
    return Response.json({ error: "No text to speak." }, { status: 200 });
  }

  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "Connection": "close",
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: process.env.OPENAI_TTS_VOICE || "onyx",
        input: text.slice(0, 4000),
        response_format: "mp3",
      }),
      // @ts-ignore
      cache: "no-store",
      keepalive: false,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => `HTTP ${res.status}`);
      console.error("[speak] OpenAI TTS error:", res.status, detail.slice(0, 300));
      return Response.json({ error: "TTS: " + detail.slice(0, 200) }, { status: 200 });
    }

    // Fully consume the response body into a buffer, then close
    const buf = await res.arrayBuffer();
    console.log(`[speak] OK ${buf.byteLength}b`);

    return new Response(buf, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "Content-Length": String(buf.byteLength),
      },
    });
  } catch (e: any) {
    console.error("[speak] Error:", e?.message);
    return Response.json({ error: "TTS failed: " + String(e?.message || e) }, { status: 200 });
  }
}
