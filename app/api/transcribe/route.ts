import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return Response.json({ error: "OPENAI_API_KEY is not set." }, { status: 200 });
  }

  try {
    const form = await req.formData();
    const audio = form.get("audio") as File | null;
    if (!audio || audio.size === 0) {
      return Response.json({ error: "No audio received." }, { status: 200 });
    }

    // Derive a filename whose extension matches the blob's mime type, so Whisper
    // accepts it across browsers (Chrome -> webm, Safari -> mp4/m4a).
    const type = audio.type || "audio/webm";
    let ext = "webm";
    if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) ext = "mp4";
    else if (type.includes("ogg")) ext = "ogg";
    else if (type.includes("wav")) ext = "wav";
    else if (type.includes("mpeg") || type.includes("mp3")) ext = "mp3";

    const upstream = new FormData();
    upstream.append("file", audio, `speech.${ext}`);
    upstream.append("model", "whisper-1");
    upstream.append("language", "en");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Connection": "close",
      },
      body: upstream,
      // @ts-ignore
      cache: "no-store",
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      const detail = data?.error?.message || `HTTP ${res.status}`;
      return Response.json({ error: "Whisper: " + detail }, { status: 200 });
    }
    return Response.json({ text: (data.text || "").trim() });
  } catch (e: any) {
    return Response.json({ error: "Transcribe error: " + String(e?.message || e) }, { status: 200 });
  }
}
