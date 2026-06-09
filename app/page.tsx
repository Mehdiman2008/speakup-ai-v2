"use client";

import React, { useEffect, useRef, useState } from "react";
import { MODES, modeMeta } from "@/lib/prompts";
import {
  loadErrors,
  saveErrors,
  loadDna,
  saveDna,
  mergeDna,
  loadSessions,
  saveSession,
  saveSessionsLocal,
  deleteSession,
  clearSessions,
} from "@/lib/storage";
import type {
  ChatMessage,
  ErrorEntry,
  ModeId,
  Scenario,
  SpeakingDNA,
  SavedSession,
} from "@/lib/types";
import { getSupabase, supabaseEnabled } from "@/lib/supabaseClient";
import { cloudLoad, cloudSave, mergeBundles, type CloudBundle } from "@/lib/cloudStore";

/* ----------------------------- THEME --------------------------------------- */
const C = {
  paper: "#F4F1E9",
  paper2: "#EFEBE0",
  ink: "#1B1A16",
  inkSoft: "#6B675C",
  inkFaint: "#A8A294",
  line: "#DFD9CC",
  card: "#FBFAF5",
  brand: "#157A5B",
  brandSoft: "#E2F1EA",
  coral: "#CF5A2F",
};

/* ----- what gets read aloud from an assistant message ----- */
function getSpeakable(content: string): string {
  if (/## Session Feedback|## Shadowing Practice/.test(content)) return "";
  const rp = content.match(/\[ROLEPLAY\]([\s\S]*?)\[\/ROLEPLAY\]/);
  if (rp) return rp[1].trim();
  if (/\[FEEDBACK\]/.test(content)) return "";
  if (content.startsWith("[error]")) return "";
  return content.trim();
}

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const opts = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];
  return opts.find((t) => MediaRecorder.isTypeSupported(t));
}

/* ============================== APP ======================================= */
export default function Page() {
  const [screen, setScreen] = useState<"home" | "chat" | "errorbank" | "dna" | "history">("home");
  const [mode, setMode] = useState<ModeId>("realistic");
  const [scenario, setScenario] = useState<Scenario>({
    description: "",
    myRole: "Structural Engineer",
    aiRole: "Contractor",
    goal: "Defend the structural detail and get sign-off",
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ended, setEnded] = useState(false);
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [dna, setDna] = useState<SpeakingDNA | null>(null);
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [viewing, setViewing] = useState<SavedSession | null>(null); // a past session opened read-only
  const [toast, setToast] = useState("");
  const [secs, setSecs] = useState(0);

  // voice
  const [ttsOn, setTtsOn] = useState(true);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // help panel (independent assistant)
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpMessages, setHelpMessages] = useState<ChatMessage[]>([]);
  const [helpInput, setHelpInput] = useState("");
  const [helpLoading, setHelpLoading] = useState(false);

  // auth / cloud sync
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const syncedRef = useRef(false);
  const cloudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const msgRef = useRef<ChatMessage[]>([]);
  msgRef.current = messages;
  const sessionIdRef = useRef<number>(0);
  const secsRef = useRef<number>(0);
  secsRef.current = secs;

  useEffect(() => {
    setErrors(loadErrors());
    setDna(loadDna());
    setSessions(loadSessions());
  }, []);

  // Watch auth state; on sign-in, merge local data with the cloud once.
  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserEmail(data.user.email || null);
        syncOnLogin();
      }
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      const email = session?.user?.email || null;
      setUserEmail(email);
      if (email) {
        syncedRef.current = false;
        syncOnLogin();
      }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function syncOnLogin() {
    if (syncedRef.current) return;
    syncedRef.current = true;
    const cloud = await cloudLoad();
    if (!cloud) return;
    const local: CloudBundle = { sessions: loadSessions(), errors: loadErrors(), dna: loadDna() };
    const merged = mergeBundles(local, cloud);
    // reflect merged data locally + in state
    setSessions(merged.sessions);
    setErrors(merged.errors);
    setDna(merged.dna);
    saveSessionsLocal(merged.sessions);
    saveErrors(merged.errors);
    saveDna(merged.dna);
    await cloudSave(merged);
    flash("Synced across your devices ✓");
  }

  // Debounced push to cloud whenever data changes while signed in.
  useEffect(() => {
    if (!userEmail) return;
    if (cloudTimer.current) clearTimeout(cloudTimer.current);
    cloudTimer.current = setTimeout(() => {
      cloudSave({ sessions, errors, dna });
    }, 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, errors, dna, userEmail]);


  useEffect(() => {
    const t = setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
    return () => clearTimeout(t);
  }, [messages, loading, transcribing]);

  useEffect(() => {
    if (screen !== "history") setViewing(null);
  }, [screen]);

  function flash(t: string) {
    setToast(t);
    setTimeout(() => setToast(""), 2800);
  }
  function fmt(s: number) {
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  /* ----- session lifecycle ----- */
  function startSession() {
    stopVoice();
    setMessages([]);
    setEnded(false);
    setSecs(0);
    setScreen("chat");
    sessionIdRef.current = Date.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setSecs((x) => x + 1), 1000);
    const opener = `Begin the roleplay now as ${scenario.aiRole}. Open with a realistic, specific concern or question based on this scenario: ${scenario.description || scenario.goal}. No introductions — just start the scene.`;
    runTurn([], opener, true);
  }

  // Persist the current conversation to history (called on exit / end).
  function persistSession() {
    const msgs = msgRef.current;
    // Only save if there's a real exchange (more than just the hidden opener).
    const real = msgs.filter((m) => !m.hidden);
    if (real.length < 2 || !sessionIdRef.current) return;
    const session: SavedSession = {
      id: sessionIdRef.current,
      date: new Date().toLocaleString(),
      ts: sessionIdRef.current,
      mode,
      scenario,
      messages: msgs,
      durationSec: secsRef.current,
    };
    const next = saveSession(session);
    setSessions(next);
  }

  function exitSession() {
    stopVoice();
    if (timerRef.current) clearInterval(timerRef.current);
    persistSession();
    setScreen("home");
  }

  /* ----- core turn ----- */
  async function runTurn(history: ChatMessage[], userText: string, hidden = false) {
    const apiHistory = [...history, { role: "user" as const, content: userText }];
    setMessages((m) => [...m, { role: "user", content: userText, hidden }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiHistory, scenario, mode }),
      });
      const data = await res.json().catch(() => ({ error: "Server returned an invalid response." }));
      if (data.error) {
        setMessages((m) => [...m, { role: "assistant", content: "[error] " + data.error }]);
        return;
      }
      const cleaned = processReply(data.reply || "");
      setMessages((m) => {
        const updated = [...m, { role: "assistant" as const, content: cleaned }];
        msgRef.current = updated;
        return updated;
      });
      speakReply(cleaned);
      // Auto-save the whole conversation to history when the session ends.
      if (userText === "/end") {
        setTimeout(persistSession, 0);
      }
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: "[error] Couldn't reach the server: " + String(e?.message || e) }]);
    } finally {
      setLoading(false);
    }
  }

  // strip & persist machine blocks, return display text
  function processReply(reply: string): string {
    let text = reply;

    // Collect ALL error-bank blocks (auto-saved on /end, one per mistake)
    const ebMatches = [...text.matchAll(/\[ERRORBANK\]([\s\S]*?)\[\/ERRORBANK\]/g)];
    if (ebMatches.length) {
      const newEntries: ErrorEntry[] = [];
      ebMatches.forEach((m, idx) => {
        try {
          const obj = JSON.parse(m[1].trim());
          if (obj.mySentence) {
            newEntries.push({
              id: Date.now() + idx,
              date: new Date().toLocaleDateString(),
              scenario: scenario.aiRole + " / " + (scenario.goal || ""),
              mySentence: obj.mySentence,
              correct: obj.correct,
              natural: obj.natural,
              notes: obj.notes,
            });
          }
        } catch {
          /* ignore one bad block */
        }
        text = text.replace(m[0], "");
      });
      if (newEntries.length) {
        setErrors((prev) => {
          const next = [...newEntries, ...prev];
          saveErrors(next);
          return next;
        });
        flash(`Saved ${newEntries.length} to Error Bank ✓`);
      }
      text = text.trim();
    }

    const dn = text.match(/\[DNA\]([\s\S]*?)\[\/DNA\]/);
    if (dn) {
      try {
        const upd = JSON.parse(dn[1].trim());
        setDna((prev) => {
          const merged = mergeDna(prev, upd);
          saveDna(merged);
          return merged;
        });
      } catch {
        /* ignore */
      }
      text = text.replace(dn[0], "").trim();
    }

    return text;
  }

  /* ----- sending ----- */
  function submit(text?: string) {
    const t = (text ?? input).trim();
    if (!t || loading) return;
    stopSpeaking();
    setInput("");
    if (t === "/dna") {
      setScreen("dna");
      return;
    }
    if (t === "/mode") {
      const mm = modeMeta(mode);
      flash(`Mode: ${mm.label} — ${mm.rule}`);
      return;
    }
    if (t === "/end") {
      setEnded(true);
      if (timerRef.current) clearInterval(timerRef.current);
    }
    runTurn(msgRef.current, t);
  }

  /* ----- voice: text-to-speech ----- */
  function stopSpeaking() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setSpeaking(false);
  }
  async function speakReply(text: string) {
    const say = getSpeakable(text);
    if (!ttsOn || !say) return;
    try {
      setSpeaking(true);
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: say }),
      });
      const ctype = res.headers.get("content-type") || "";
      if (!ctype.includes("audio")) {
        // route returned a JSON error instead of mp3
        const data = await res.json().catch(() => null);
        setSpeaking(false);
        if (data?.error) flash("🔇 " + data.error);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setSpeaking(false);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => setSpeaking(false);
      try {
        await audio.play();
      } catch {
        // Browser blocked autoplay (no user gesture yet). Not an error.
        setSpeaking(false);
      }
    } catch (e: any) {
      setSpeaking(false);
      flash("🔇 Voice failed: " + String(e?.message || e));
    }
  }
  function toggleTts() {
    setTtsOn((v) => {
      if (v) stopSpeaking();
      return !v;
    });
  }

  /* ----- voice: speech-to-text (MediaRecorder + Whisper) ----- */
  function stopVoice() {
    stopSpeaking();
    try {
      if (mrRef.current && mrRef.current.state === "recording") mrRef.current.stop();
    } catch {}
    setListening(false);
  }
  async function toggleMic() {
    if (loading || speaking || transcribing) return;
    if (listening) {
      try {
        mrRef.current && mrRef.current.stop();
      } catch {}
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices || typeof MediaRecorder === "undefined") {
      flash("This browser doesn't support audio recording.");
      return;
    }
    stopSpeaking();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mrRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setListening(false);
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (!blob.size) {
          flash("No audio captured — try again.");
          return;
        }
        setTranscribing(true);
        try {
          const fd = new FormData();
          fd.append("audio", blob, "speech");
          const res = await fetch("/api/transcribe", { method: "POST", body: fd });
          const data = await res.json().catch(() => null);
          setTranscribing(false);
          if (!data || data.error) {
            flash("🎙 " + (data?.error || "Transcription failed."));
            return;
          }
          const t = (data.text || "").trim();
          if (t) runTurn(msgRef.current, t);
          else flash("Didn't catch that — try again.");
        } catch (e: any) {
          setTranscribing(false);
          flash("🎙 Transcription failed: " + String(e?.message || e));
        }
      };
      mr.start();
      setListening(true);
    } catch (e: any) {
      const name = e?.name || "";
      if (name === "NotAllowedError") flash("Microphone permission denied. Allow it in the browser address bar.");
      else flash("Couldn't access the microphone: " + String(e?.message || name || e));
    }
  }

  /* ----- auth ----- */
  async function sendMagicLink(email: string) {
    const sb = getSupabase();
    if (!sb) { flash("Sync isn't configured."); return; }
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined },
    });
    if (error) flash("⚠️ " + error.message);
    else flash("Login link sent — check your email ✉️");
  }
  async function signOut() {
    const sb = getSupabase();
    if (sb) await sb.auth.signOut();
    setUserEmail(null);
    syncedRef.current = false;
    flash("Signed out — data stays on this device.");
  }

  /* ----- help panel (independent of roleplay) ----- */
  async function sendHelp(text?: string) {
    const t = (text ?? helpInput).trim();
    if (!t || helpLoading) return;
    setHelpInput("");
    const next = [...helpMessages, { role: "user" as const, content: t }];
    setHelpMessages(next);
    setHelpLoading(true);
    try {
      const res = await fetch("/api/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, scenario, mode }),
      });
      const data = await res.json().catch(() => ({ error: "Invalid response." }));
      const reply = data.error ? "⚠️ " + data.error : data.reply;
      setHelpMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (e: any) {
      setHelpMessages((m) => [...m, { role: "assistant", content: "⚠️ " + String(e?.message || e) }]);
    } finally {
      setHelpLoading(false);
    }
  }

  /* ----- error bank / dna controls ----- */
  function clearErrors() {
    setErrors([]);
    saveErrors([]);
  }
  function clearDna() {
    setDna(null);
    saveDna(null);
    flash("Speaking DNA reset");
  }

  const mm = modeMeta(mode);

  /* ============================ RENDER ==================================== */
  return (
    <div style={{ minHeight: "100vh", position: "relative" }}>
      <div style={{ maxWidth: 660, margin: "0 auto", padding: "22px 18px 64px" }}>
        {/* Top bar */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 26 }}>
          <button
            onClick={() => (screen === "chat" ? null : setScreen("home"))}
            style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}
          >
            <div style={{ fontFamily: "Fraunces, serif", fontSize: 25, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1 }}>
              SpeakUp<span style={{ color: C.brand }}>.</span>
            </div>
            <div style={{ fontSize: 11, color: C.inkSoft, marginTop: 3, letterSpacing: "0.02em" }}>
              English communication simulator
            </div>
          </button>

          {screen === "chat" ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => setHelpOpen((v) => !v)}
                style={{ fontSize: 11, fontWeight: 600, padding: "5px 11px", borderRadius: 999, cursor: "pointer", border: `1px solid ${helpOpen ? C.brand : C.line}`, background: helpOpen ? C.brandSoft : C.card, color: helpOpen ? C.brand : C.inkSoft }}>
                ? Help
              </button>
              <Chip>{fmt(secs)}</Chip>
              <span style={{ fontSize: 11, fontWeight: 600, color: mm.color, background: mm.color + "16", borderRadius: 999, padding: "4px 11px" }}>
                {mm.label}
              </span>
            </div>
          ) : (
            <nav style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <NavBtn active={screen === "history"} onClick={() => setScreen("history")}>
                History{sessions.length ? ` ${sessions.length}` : ""}
              </NavBtn>
              <NavBtn active={screen === "errorbank"} onClick={() => setScreen("errorbank")}>
                Error Bank{errors.length ? ` ${errors.length}` : ""}
              </NavBtn>
              <NavBtn active={screen === "dna"} onClick={() => setScreen("dna")}>
                Speaking DNA
              </NavBtn>
              {supabaseEnabled() && (
                userEmail ? (
                  <NavBtn active={false} onClick={signOut}>
                    ✓ {userEmail.split("@")[0]}
                  </NavBtn>
                ) : (
                  <NavBtn active={false} onClick={() => setAuthOpen(true)}>
                    ⇄ Sync
                  </NavBtn>
                )
              )}
            </nav>
          )}
        </header>

        {authOpen && !userEmail && (
          <AuthModal onClose={() => setAuthOpen(false)} onSend={sendMagicLink} />
        )}

        {screen === "home" && (
          <HomeScreen mode={mode} setMode={setMode} scenario={scenario} setScenario={setScenario} onStart={startSession} />
        )}

        {screen === "chat" && (
          <ChatScreen
            messages={messages}
            loading={loading}
            transcribing={transcribing}
            input={input}
            setInput={setInput}
            submit={submit}
            ended={ended}
            aiRole={scenario.aiRole}
            endRef={endRef}
            onExit={exitSession}
            modeColor={mm.color}
            listening={listening}
            speaking={speaking}
            ttsOn={ttsOn}
            toggleTts={toggleTts}
            onMic={toggleMic}
            onStopSpeak={stopSpeaking}
            onSpeak={speakReply}
          />
        )}

        {screen === "errorbank" && <ErrorBankScreen errors={errors} onClear={clearErrors} onBack={() => setScreen("home")} />}
        {screen === "dna" && <DnaScreen dna={dna} onClear={clearDna} onBack={() => setScreen("home")} />}
        {screen === "history" && (
          viewing ? (
            <SessionViewer session={viewing} onBack={() => setViewing(null)} onSpeak={speakReply} ttsOn={ttsOn} />
          ) : (
            <HistoryScreen
              sessions={sessions}
              onOpen={(s) => setViewing(s)}
              onDelete={(id) => setSessions(deleteSession(id))}
              onClear={() => { clearSessions(); setSessions([]); }}
              onBack={() => setScreen("home")}
            />
          )
        )}
      </div>

      {helpOpen && screen === "chat" && (
        <HelpPanel
          messages={helpMessages}
          input={helpInput}
          setInput={setHelpInput}
          send={sendHelp}
          loading={helpLoading}
          onClose={() => setHelpOpen(false)}
        />
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: C.ink, color: C.paper, padding: "10px 18px", borderRadius: 999, fontSize: 13, fontWeight: 500, boxShadow: "0 8px 30px rgba(0,0,0,0.22)", zIndex: 50, maxWidth: "88vw" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

/* ========================= AUTH MODAL ==================================== */
function AuthModal({ onClose, onSend }: { onClose: () => void; onSend: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(20,18,14,0.45)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: C.card, borderRadius: 18, padding: 22, width: "min(380px, 94vw)", boxShadow: "0 18px 50px rgba(0,0,0,0.25)" }}>
        <div style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Sync across devices</div>
        <p style={{ fontSize: 13, color: C.inkSoft, lineHeight: 1.6, marginTop: 0 }}>
          ایمیلت رو وارد کن؛ یک لینک ورود برات می‌فرستیم. بعد از ورود، History و Error Bank و DNA بین گوشی و لپ‌تاپ sync می‌شوند.
        </p>
        {sent ? (
          <div style={{ background: C.brandSoft, border: "1px solid #C6E3D6", borderRadius: 12, padding: "12px 14px", fontSize: 13.5, color: C.brand, lineHeight: 1.6 }}>
            ✉️ لینک ورود به <b>{email}</b> ارسال شد. ایمیلت رو باز کن و روی لینک بزن — همین صفحه وارد می‌شود.
          </div>
        ) : (
          <>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && valid) { onSend(email.trim()); setSent(true); } }}
              placeholder="you@example.com"
              style={{ ...inp, marginBottom: 10 }}
            />
            <button
              onClick={() => { if (valid) { onSend(email.trim()); setSent(true); } }}
              disabled={!valid}
              style={{ width: "100%", background: valid ? C.brand : C.line, color: "#fff", border: "none", borderRadius: 11, padding: "12px", fontSize: 14.5, fontWeight: 600, cursor: valid ? "pointer" : "default" }}>
              Send login link
            </button>
          </>
        )}
        <button onClick={onClose}
          style={{ width: "100%", marginTop: 10, background: "none", border: "none", color: C.inkSoft, fontSize: 12.5, cursor: "pointer" }}>
          {sent ? "Close" : "Cancel"}
        </button>
      </div>
    </div>
  );
}

/* ========================= HELP PANEL ==================================== */
function HelpPanel({ messages, input, setInput, send, loading, onClose }: {
  messages: ChatMessage[];
  input: string;
  setInput: (s: string) => void;
  send: (t?: string) => void;
  loading: boolean;
  onClose: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);
  return (
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(380px, 92vw)", background: C.card, borderLeft: `1px solid ${C.line}`, boxShadow: "-8px 0 30px rgba(0,0,0,0.12)", zIndex: 60, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: `1px solid ${C.line}` }}>
        <div>
          <div style={{ fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 600 }}>Help</div>
          <div style={{ fontSize: 11, color: C.inkSoft }}>جدا از تمرین — ترجمه، توضیح، سؤال</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: C.inkSoft, padding: 0, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 && !loading && (
          <div style={{ color: C.inkSoft, fontSize: 13, lineHeight: 1.7, marginTop: 8 }}>
            این یک دستیار جداست و به تمرین اصلی دست نمی‌زند. می‌تونی بپرسی:
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {["معنی \"push back\" چیه؟", "How do I say این قابل اجرا نیست politely?", "ترجمه کن: لطفاً تاییدیه رو امروز بفرست"].map((ex) => (
                <button key={ex} onClick={() => send(ex)}
                  style={{ textAlign: "right", fontSize: 12.5, padding: "8px 11px", borderRadius: 10, border: `1px solid ${C.line}`, background: "#fff", color: C.ink, cursor: "pointer", direction: "rtl" as const }}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "88%",
            background: m.role === "user" ? C.brandSoft : "#fff",
            border: `1px solid ${m.role === "user" ? "#C6E3D6" : C.line}`,
            borderRadius: m.role === "user" ? "13px 13px 4px 13px" : "13px 13px 13px 4px",
            padding: "8px 12px", fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap",
          }}>
            {m.content}
          </div>
        ))}
        {loading && <div style={{ alignSelf: "flex-start", color: C.inkFaint, fontSize: 13 }}>…</div>}
        <div ref={endRef} />
      </div>

      <div style={{ display: "flex", gap: 8, padding: "12px 14px", borderTop: `1px solid ${C.line}` }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="سؤالت رو بنویس…"
          rows={1}
          style={{ ...inp, flex: 1, padding: "10px 12px", resize: "none", maxHeight: 110 }}
        />
        <button onClick={() => send()} disabled={loading || !input.trim()}
          style={{ width: 42, height: 42, borderRadius: 11, border: "none", background: input.trim() ? C.brand : C.line, color: "#fff", fontSize: 17, cursor: input.trim() ? "pointer" : "default", flexShrink: 0 }}>
          ↑
        </button>
      </div>
    </div>
  );
}

/* ========================= HOME / SCENARIO ================================ */
function HomeScreen({
  mode,
  setMode,
  scenario,
  setScenario,
  onStart,
}: {
  mode: ModeId;
  setMode: (m: ModeId) => void;
  scenario: Scenario;
  setScenario: (s: Scenario) => void;
  onStart: () => void;
}) {
  const set = (k: keyof Scenario) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setScenario({ ...scenario, [k]: e.target.value });
  return (
    <div>
      <h1 style={{ fontFamily: "Fraunces, serif", fontWeight: 500, fontSize: 30, lineHeight: 1.15, letterSpacing: "-0.02em", margin: "0 0 6px" }}>
        Build a scenario.
        <br />
        <span style={{ color: C.brand }}>Talk it out for real.</span>
      </h1>
      <p style={{ color: C.inkSoft, fontSize: 14, margin: "0 0 22px", maxWidth: 460 }}>
        Pick a mode, set the scene, and the AI plays a real contractor, client, or interviewer in Australian workplace English. Coach tiers add live scores and notes.
      </p>

      <SectionLabel>
        Mode <span style={{ color: C.inkFaint }}>· فقط یک مود فعال است</span>
      </SectionLabel>
      <div style={{ display: "grid", gap: 9, marginBottom: 22 }}>
        {MODES.map((m) => {
          const on = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 13,
                textAlign: "left",
                cursor: "pointer",
                background: on ? "#fff" : C.card,
                border: `1px solid ${on ? m.color : C.line}`,
                borderRadius: 14,
                padding: "12px 14px",
                transition: "all .15s",
                boxShadow: on ? `0 2px 0 ${m.color}` : "none",
              }}
            >
              <span style={{ width: 6, alignSelf: "stretch", borderRadius: 4, background: m.color, opacity: on ? 1 : 0.4 }} />
              <span style={{ flex: 1 }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{m.label}</span>
                  <span style={{ fontSize: 11, color: C.inkSoft, fontFamily: "Vazirmatn, sans-serif", direction: "rtl" }}>{m.fa}</span>
                </span>
                <span style={{ display: "block", fontSize: 12.5, color: C.inkSoft, marginTop: 2 }}>{m.rule}</span>
              </span>
              <span style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${on ? m.color : C.line}`, background: on ? m.color : "transparent", flexShrink: 0 }} />
            </button>
          );
        })}
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
        <SectionLabel>
          Scenario <span style={{ color: C.inkFaint }}>· سناریو</span>
        </SectionLabel>
        <textarea
          value={scenario.description}
          onChange={set("description")}
          placeholder="مثال: فردا با پیمانکار جلسه دارم؛ احتمالاً میگه این دیتیل قابل‌اجرا نیست و من باید ازش دفاع کنم و تاییدیه بگیرم."
          style={{ ...inp, minHeight: 78, lineHeight: 1.7, direction: "rtl", fontFamily: "Vazirmatn, sans-serif", marginBottom: 12, resize: "vertical" }}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
          <Field label="My role · نقش من">
            <input value={scenario.myRole} onChange={set("myRole")} style={inp} />
          </Field>
          <Field label="AI role · نقش طرف مقابل">
            <input value={scenario.aiRole} onChange={set("aiRole")} style={inp} />
          </Field>
        </div>
        <Field label="Goal · هدف">
          <input value={scenario.goal} onChange={set("goal")} style={inp} />
        </Field>
      </div>

      <button
        onClick={onStart}
        style={{ width: "100%", marginTop: 16, background: C.brand, color: "#fff", border: "none", borderRadius: 13, padding: "15px", fontSize: 15.5, fontWeight: 600, cursor: "pointer", letterSpacing: "0.01em", boxShadow: "0 6px 22px rgba(21,122,91,0.32)" }}
      >
        Start session →
      </button>
    </div>
  );
}

/* ============================== CHAT ===================================== */
const QUICK = [
  { code: "/options", label: "Options ×5" },
  { code: "/harder", label: "Harder" },
  { code: "/easier", label: "Easier" },
];

function ChatScreen(props: {
  messages: ChatMessage[];
  loading: boolean;
  transcribing: boolean;
  input: string;
  setInput: (s: string) => void;
  submit: (t?: string) => void;
  ended: boolean;
  aiRole: string;
  endRef: React.RefObject<HTMLDivElement>;
  onExit: () => void;
  modeColor: string;
  listening: boolean;
  speaking: boolean;
  ttsOn: boolean;
  toggleTts: () => void;
  onMic: () => void;
  onStopSpeak: () => void;
  onSpeak: (text: string) => void;
}) {
  const { messages, loading, transcribing, input, setInput, submit, ended, aiRole, endRef, onExit, modeColor, listening, speaking, ttsOn, toggleTts, onMic, onStopSpeak, onSpeak } = props;
  const visible = messages.filter((m) => !m.hidden);
  const busy = loading || transcribing;

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 13, minHeight: 240, marginBottom: 14 }}>
        {visible.length === 0 && !busy && (
          <p style={{ color: C.inkFaint, fontSize: 13, textAlign: "center", margin: "40px 0" }}>Setting the scene…</p>
        )}
        {visible.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.content} aiRole={aiRole} onSpeak={onSpeak} ttsOn={ttsOn} />
        ))}
        {busy && <Typing />}
        <div ref={endRef} />
      </div>

      {/* Quick actions */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {QUICK.map((q) => (
          <button key={q.code} onClick={() => submit(q.code)} disabled={busy}
            style={{ fontSize: 12, padding: "5px 11px", borderRadius: 999, border: `1px solid ${C.line}`, background: C.card, color: C.inkSoft, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}>
            {q.label}
          </button>
        ))}
        {!ended ? (
          <button onClick={() => submit("/end")} disabled={busy}
            style={{ fontSize: 12, fontWeight: 600, padding: "5px 13px", borderRadius: 999, border: `1px solid ${C.brand}`, background: C.brandSoft, color: C.brand, cursor: "pointer" }}>
            End & review
          </button>
        ) : (
          <>
            <button onClick={() => submit("/shadowing")} disabled={busy}
              style={{ fontSize: 12, fontWeight: 600, padding: "5px 13px", borderRadius: 999, border: `1px solid ${modeColor}`, background: modeColor + "14", color: modeColor, cursor: "pointer" }}>
              Shadowing
            </button>
            <button onClick={onExit}
              style={{ fontSize: 12, padding: "5px 13px", borderRadius: 999, border: `1px solid ${C.line}`, background: C.card, color: C.inkSoft, cursor: "pointer" }}>
              New scenario
            </button>
          </>
        )}
        <button onClick={toggleTts}
          style={{ fontSize: 12, marginLeft: "auto", padding: "5px 11px", borderRadius: 999, border: `1px solid ${ttsOn ? C.brand : C.line}`, background: ttsOn ? C.brandSoft : C.card, color: ttsOn ? C.brand : C.inkSoft, cursor: "pointer" }}>
          {ttsOn ? "🔊 Voice on" : "🔇 Voice off"}
        </button>
        {speaking && (
          <button onClick={onStopSpeak}
            style={{ fontSize: 12, padding: "5px 11px", borderRadius: 999, border: `1px solid ${C.line}`, background: C.card, color: C.inkSoft, cursor: "pointer" }}>
            ⏹ Stop
          </button>
        )}
      </div>

      {/* status */}
      {(listening || speaking || transcribing) && (
        <div style={{ textAlign: "center", fontSize: 12, marginBottom: 8, fontWeight: 600, color: listening ? C.coral : C.brand }}>
          {listening ? "🎙 Recording — tap again to send" : transcribing ? "✍️ Transcribing…" : "🔊 Speaking…"}
        </div>
      )}

      {/* Input */}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <button onClick={onMic} disabled={busy || speaking}
          title="Tap to speak your answer"
          style={{
            width: 46, height: 44, borderRadius: 12, flexShrink: 0, fontSize: 18,
            border: `1px solid ${listening ? C.coral : C.line}`,
            background: listening ? C.coral : C.card,
            color: listening ? "#fff" : C.inkSoft,
            cursor: busy || speaking ? "default" : "pointer",
            opacity: busy || speaking ? 0.5 : 1,
            animation: listening ? "su-pulse 1.3s infinite" : "none",
          }}>
          {listening ? "■" : "🎙"}
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Type or tap the mic to speak… (or a /command)"
          rows={1}
          style={{ ...inp, flex: 1, padding: "11px 13px", resize: "none", maxHeight: 120 }}
        />
        <button onClick={() => submit()} disabled={busy || !input.trim()}
          style={{ width: 46, height: 44, borderRadius: 12, border: "none", background: input.trim() ? C.brand : C.line, color: "#fff", fontSize: 18, cursor: input.trim() ? "pointer" : "default", flexShrink: 0 }}>
          ↑
        </button>
      </div>
      <div style={{ textAlign: "center", marginTop: 10 }}>
        <button onClick={onExit} style={{ background: "none", border: "none", color: C.inkFaint, fontSize: 11.5, cursor: "pointer" }}>
          ✕ exit without saving
        </button>
      </div>
    </div>
  );
}

/* --------- message rendering --------- */
function Bubble({ role, content, aiRole, onSpeak, ttsOn }: { role: "user" | "assistant"; content: string; aiRole: string; onSpeak: (t: string) => void; ttsOn: boolean }) {
  if (role === "user") {
    return (
      <div style={{ alignSelf: "flex-end", maxWidth: "82%", background: C.brandSoft, border: "1px solid #C6E3D6", borderRadius: "15px 15px 5px 15px", padding: "9px 13px" }}>
        <Tag color={C.brand}>You</Tag>
        <div style={{ fontSize: 14.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{content}</div>
      </div>
    );
  }

  const isCoach = /\[FEEDBACK\]|\[ROLEPLAY\]|\[COACHNOTE\]/.test(content);
  const isFeedback = /## Session Feedback/.test(content);
  const isShadow = /## Shadowing Practice/.test(content);
  const isError = content.startsWith("[error]");

  if (isError) {
    return <div style={{ alignSelf: "center", fontSize: 12.5, color: C.coral, textAlign: "center", maxWidth: "90%" }}>{content.replace("[error] ", "")}</div>;
  }
  if (isCoach) return <CoachCard content={content} aiRole={aiRole} onSpeak={onSpeak} ttsOn={ttsOn} />;
  if (isShadow) return <ShadowingCard content={content} onSpeak={onSpeak} />;
  if (isFeedback) return <ReviewCard content={content} feedback={true} />;

  const speakable = getSpeakable(content);
  return (
    <div style={{ alignSelf: "flex-start", maxWidth: "84%", background: "#fff", border: `1px solid ${C.line}`, borderRadius: "15px 15px 15px 5px", padding: "10px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Tag color={C.inkFaint}>{aiRole}</Tag>
        {ttsOn && speakable && <SpeakBtn onClick={() => onSpeak(content)} />}
      </div>
      <div style={{ fontSize: 14.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{content}</div>
    </div>
  );
}

function SpeakBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} title="Play voice"
      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: C.inkFaint, padding: "0 2px", lineHeight: 1 }}>
      🔊
    </button>
  );
}

function CoachCard({ content, aiRole, onSpeak, ttsOn }: { content: string; aiRole: string; onSpeak: (t: string) => void; ttsOn: boolean }) {
  const fb = content.match(/\[FEEDBACK\]([\s\S]*?)\[\/FEEDBACK\]/)?.[1]?.trim();
  const rp = content.match(/\[ROLEPLAY\]([\s\S]*?)\[\/ROLEPLAY\]/)?.[1]?.trim();
  const note = content.match(/\[COACHNOTE\]([\s\S]*?)\[\/COACHNOTE\]/)?.[1]?.trim();
  return (
    <div style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", gap: 8 }}>
      {fb && (
        <div style={{ background: "#F1F6FF", border: "1px solid #C9DDF8", borderRadius: 12, padding: "11px 13px" }}>
          <Tag color="#2563EB">Feedback</Tag>
          {fb.split("\n").map((ln, i) => {
            if (/Grammar:|Naturalness:|Confidence:/.test(ln))
              return <div key={i} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, background: "#fff", border: "1px solid #DCE9FB", borderRadius: 6, padding: "4px 8px", margin: "3px 0", color: "#1E40AF" }}>{ln}</div>;
            const lbl = ln.match(/^(Correction|Natural Version|Professional Version):/);
            if (lbl) return <div key={i} style={{ fontSize: 13, marginTop: 6 }}><b style={{ color: "#374151" }}>{lbl[1]}:</b>{ln.slice(lbl[0].length)}</div>;
            return ln.trim() ? <div key={i} style={{ fontSize: 13 }}>{ln}</div> : null;
          })}
        </div>
      )}
      {rp && (
        <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: "12px 12px 12px 5px", padding: "10px 14px", alignSelf: "flex-start", maxWidth: "90%" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Tag color={C.inkFaint}>{aiRole}</Tag>
            {ttsOn && <SpeakBtn onClick={() => onSpeak(content)} />}
          </div>
          <div style={{ fontSize: 14.5, lineHeight: 1.55 }}>{rp}</div>
        </div>
      )}
      {note && (
        <div style={{ background: "#FFF8EC", border: "1px solid #F2DFB8", borderRadius: 12, padding: "9px 13px", display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span style={{ fontSize: 14, lineHeight: 1.3 }}>💡</span>
          <div>
            <Tag color="#B45309">Coach note</Tag>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: "#7A4F0A" }}>{note}</div>
          </div>
        </div>
      )}
      {!fb && !rp && !note && <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{content}</div>}
    </div>
  );
}

function ReviewCard({ content, feedback }: { content: string; feedback: boolean }) {
  return (
    <div style={{ alignSelf: "stretch", background: feedback ? "#FBFBF6" : "#fff", border: `1px solid ${C.line}`, borderLeft: `3px solid ${feedback ? C.brand : "#6D5BD0"}`, borderRadius: 12, padding: "14px 16px" }}>
      <Markdown text={content} />
    </div>
  );
}

function ShadowingCard({ content, onSpeak }: { content: string; onSpeak: (t: string) => void }) {
  // Parse "Q1: ... Natural Answer: ..." pairs into items.
  const items: { q: string; a: string }[] = [];
  const blocks = content.split(/Q\d+\s*:/i).slice(1);
  for (const b of blocks) {
    const m = b.split(/Natural Answer\s*:/i);
    const q = (m[0] || "").trim();
    const a = (m[1] || "").trim();
    if (q || a) items.push({ q, a });
  }
  return (
    <div style={{ alignSelf: "stretch", background: "#fff", border: `1px solid ${C.line}`, borderLeft: "3px solid #6D5BD0", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontFamily: "Fraunces, serif", fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Shadowing Practice</div>
      <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 14 }}>گوش بده، Pause کن، تکرار کن — بدون نمره و اصلاح.</div>
      {items.length === 0 && <Markdown text={content} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {items.map((it, i) => (
          <div key={i} style={{ borderTop: i ? `1px solid ${C.line}` : "none", paddingTop: i ? 12 : 0 }}>
            {it.q && (
              <div style={{ marginBottom: 8 }}>
                <Tag color={C.inkFaint}>Q{i + 1}</Tag>
                <div style={{ fontSize: 13.5, lineHeight: 1.5, color: C.inkSoft }}>{it.q}</div>
              </div>
            )}
            {it.a && (
              <div style={{ background: "#F7F5FF", border: "1px solid #E0DAF5", borderRadius: 10, padding: "9px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 3 }}>
                  <Tag color="#6D5BD0">Natural answer</Tag>
                  <PlayControl text={it.a} onSpeak={onSpeak} />
                </div>
                <div style={{ fontSize: 14.5, lineHeight: 1.55 }}>{it.a}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PlayControl({ text, onSpeak }: { text: string; onSpeak: (t: string) => void }) {
  return (
    <button onClick={() => onSpeak(text)} title="Play / replay"
      style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 999, border: "1px solid #C9BCEF", background: "#fff", color: "#6D5BD0", cursor: "pointer" }}>
      ▶ Play
    </button>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.65 }}>
      {text.split("\n").map((ln, i) => {
        if (ln.startsWith("## "))
          return <div key={i} style={{ fontFamily: "Fraunces, serif", fontSize: 18, fontWeight: 600, margin: "2px 0 10px" }}>{ln.slice(3)}</div>;
        if (/^\*\*.*\*\*$/.test(ln.trim()))
          return <div key={i} style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", color: C.inkSoft, margin: "12px 0 4px" }}>{ln.replace(/\*\*/g, "")}</div>;
        if ((/\d+\/10/.test(ln) && ln.includes("|")) || /^Grammar:/.test(ln.trim()))
          return <div key={i} style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5, background: C.paper2, borderRadius: 7, padding: "7px 9px", margin: "3px 0", lineHeight: 1.8 }}>{ln}</div>;
        return ln.trim() ? <div key={i} style={{ margin: "2px 0" }}>{ln}</div> : <div key={i} style={{ height: 4 }} />;
      })}
    </div>
  );
}

/* ========================== HISTORY ====================================== */
function HistoryScreen({ sessions, onOpen, onDelete, onClear, onBack }: {
  sessions: SavedSession[];
  onOpen: (s: SavedSession) => void;
  onDelete: (id: number) => void;
  onClear: () => void;
  onBack: () => void;
}) {
  function fmtDur(s: number) {
    const m = Math.floor(s / 60);
    return m > 0 ? `${m} min` : `${s}s`;
  }
  return (
    <div>
      <ScreenHead title="History" fa="جلسه‌های قبلی" onBack={onBack}>
        {sessions.length > 0 && <button onClick={onClear} style={miniBtn}>Clear all</button>}
      </ScreenHead>
      {sessions.length === 0 ? (
        <Empty>
          No saved sessions yet. When you finish a session with <Code>End &amp; review</Code> (or leave it), the whole conversation is saved here so you can review it later.
        </Empty>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {sessions.map((s) => {
            const meta = modeMeta(s.mode);
            const turns = s.messages.filter((m) => !m.hidden).length;
            return (
              <div key={s.id} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 13, display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ width: 5, alignSelf: "stretch", borderRadius: 4, background: meta.color }} />
                <button onClick={() => onOpen(s)} style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{s.scenario.myRole} vs {s.scenario.aiRole}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: meta.color }}>{meta.label}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 380 }}>
                    {s.scenario.goal || s.scenario.description || "—"}
                  </div>
                  <div style={{ fontSize: 11, color: C.inkFaint, marginTop: 4 }}>{s.date} · {turns} messages · {fmtDur(s.durationSec)}</div>
                </button>
                <button onClick={() => onDelete(s.id)} title="Delete" style={{ background: "none", border: "none", cursor: "pointer", color: C.inkFaint, fontSize: 16, padding: "4px 6px" }}>🗑</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SessionViewer({ session, onBack, onSpeak, ttsOn }: {
  session: SavedSession;
  onBack: () => void;
  onSpeak: (t: string) => void;
  ttsOn: boolean;
}) {
  const meta = modeMeta(session.mode);
  const visible = session.messages.filter((m) => !m.hidden);
  return (
    <div>
      <ScreenHead title="Review" fa="مرور جلسه" onBack={onBack} />
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderLeft: `3px solid ${meta.color}`, borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600 }}>{session.scenario.myRole} vs {session.scenario.aiRole}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: meta.color }}>{meta.label}</span>
        </div>
        {session.scenario.goal && <div style={{ fontSize: 13, color: C.inkSoft, marginTop: 3 }}>Goal: {session.scenario.goal}</div>}
        <div style={{ fontSize: 11, color: C.inkFaint, marginTop: 4 }}>{session.date}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {visible.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.content} aiRole={session.scenario.aiRole} onSpeak={onSpeak} ttsOn={ttsOn} />
        ))}
      </div>
    </div>
  );
}

/* ========================== ERROR BANK =================================== */
function ErrorBankScreen({ errors, onClear, onBack }: { errors: ErrorEntry[]; onClear: () => void; onBack: () => void }) {
  return (
    <div>
      <ScreenHead title="Error Bank" fa="بانک خطاها" onBack={onBack}>
        {errors.length > 0 && <button onClick={onClear} style={miniBtn}>Clear all</button>}
      </ScreenHead>
      {errors.length === 0 ? (
        <Empty>
          No saved mistakes yet. They&apos;re collected automatically when you finish a session with <Code>End &amp; review</Code>.
        </Empty>
      ) : (
        <div style={{ display: "grid", gap: 11 }}>
          {errors.map((e) => (
            <div key={e.id} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14 }}>
              <div style={{ fontSize: 11, color: C.inkFaint, marginBottom: 8 }}>{e.date} · {e.scenario}</div>
              <Row label="You said" v={e.mySentence} strike />
              <Row label="Correct" v={e.correct} color={C.brand} />
              <Row label="Natural" v={e.natural} color="#6D5BD0" />
              {e.notes && <div style={{ fontSize: 12.5, color: C.inkSoft, marginTop: 6, fontStyle: "italic" }}>{e.notes}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function Row({ label, v, color, strike }: { label: string; v: string; color?: string; strike?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 9, margin: "3px 0", fontSize: 13.5 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: color || C.inkFaint, width: 64, flexShrink: 0, paddingTop: 2, letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ lineHeight: 1.5, textDecoration: strike ? "line-through" : "none", color: strike ? C.inkSoft : C.ink }}>{v}</span>
    </div>
  );
}

/* ========================= SPEAKING DNA ================================== */
function DnaScreen({ dna, onClear, onBack }: { dna: SpeakingDNA | null; onClear: () => void; onBack: () => void }) {
  const groups: { k: keyof SpeakingDNA; t: string; c: string }[] = [
    { k: "recurringWeaknesses", t: "Recurring weaknesses", c: C.coral },
    { k: "improvingAreas", t: "Improving areas", c: C.brand },
    { k: "grammarPatterns", t: "Grammar patterns", c: "#2563EB" },
    { k: "overusedPhrases", t: "Overused phrases", c: "#B45309" },
    { k: "confidenceIssues", t: "Confidence", c: "#6D5BD0" },
    { k: "missingSkills", t: "Missing skills", c: "#0E7490" },
  ];
  const has = dna && groups.some((g) => (dna[g.k] as string[] | undefined)?.length);
  return (
    <div>
      <ScreenHead title="Speaking DNA" fa="DNA گفتاری" onBack={onBack}>
        {dna && <button onClick={onClear} style={miniBtn}>Reset</button>}
      </ScreenHead>
      {!has ? (
        <Empty>
          Your speaking profile builds up after each session. Finish a session with <Code>/end</Code> to start tracking patterns.
        </Empty>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, fontSize: 12, color: C.inkSoft }}>
            <Chip>{dna!.sessions || 1} session{(dna!.sessions || 1) > 1 ? "s" : ""}</Chip>
            {dna!.updated && <Chip>updated {dna!.updated}</Chip>}
          </div>
          {dna!.nextFocus && (
            <div style={{ background: C.brandSoft, border: `1px solid #C6E3D6`, borderRadius: 14, padding: "13px 15px", marginBottom: 16 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: C.brand, marginBottom: 4 }}>Next focus</div>
              <div style={{ fontSize: 14.5 }}>{dna!.nextFocus}</div>
            </div>
          )}
          <div style={{ display: "grid", gap: 12 }}>
            {groups
              .filter((g) => (dna![g.k] as string[] | undefined)?.length)
              .map((g) => (
                <div key={g.k}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: g.c, marginBottom: 7 }}>{g.t}</div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    {(dna![g.k] as string[]).map((tag, i) => (
                      <span key={i} style={{ fontSize: 13, background: g.c + "12", border: `1px solid ${g.c}33`, color: g.c, borderRadius: 9, padding: "6px 11px", lineHeight: 1.4 }}>{tag}</span>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ============================ PRIMITIVES ================================= */
const inp: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 10,
  border: `1px solid ${C.line}`,
  fontSize: 13.5,
  boxSizing: "border-box",
  background: "#fff",
  color: C.ink,
  fontFamily: "'Hanken Grotesk', sans-serif",
  outline: "none",
};
const miniBtn: React.CSSProperties = { fontSize: 12, padding: "5px 11px", borderRadius: 999, border: `1px solid ${C.line}`, background: C.card, color: C.inkSoft, cursor: "pointer" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginTop: 11 }}>
      <span style={{ fontSize: 11, color: C.inkSoft, display: "block", marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: C.inkSoft, marginBottom: 11 }}>{children}</div>;
}
function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color, marginBottom: 4 }}>{children}</div>;
}
function Chip({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11.5, background: C.paper2, border: `1px solid ${C.line}`, borderRadius: 999, padding: "4px 10px", color: C.inkSoft }}>{children}</span>;
}
function NavBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ fontSize: 12, fontWeight: active ? 600 : 500, padding: "6px 11px", borderRadius: 999, border: `1px solid ${active ? C.brand : C.line}`, background: active ? C.brandSoft : C.card, color: active ? C.brand : C.inkSoft, cursor: "pointer" }}>
      {children}
    </button>
  );
}
function ScreenHead({ title, fa, onBack, children }: { title: string; fa: string; onBack: () => void; children?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: C.inkSoft, fontSize: 18, padding: 0 }}>←</button>
        <h2 style={{ fontFamily: "Fraunces, serif", fontWeight: 500, fontSize: 24, margin: 0 }}>{title}</h2>
        <span style={{ fontSize: 12, color: C.inkFaint, fontFamily: "Vazirmatn, sans-serif", direction: "rtl" }}>{fa}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ background: C.card, border: `1px dashed ${C.line}`, borderRadius: 14, padding: "34px 22px", textAlign: "center", color: C.inkSoft, fontSize: 14, lineHeight: 1.6 }}>{children}</div>;
}
function Code({ children }: { children: React.ReactNode }) {
  return <code style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5, background: C.paper2, borderRadius: 5, padding: "1px 6px", color: C.ink }}>{children}</code>;
}
function Typing() {
  return (
    <div style={{ alignSelf: "flex-start", background: "#fff", border: `1px solid ${C.line}`, borderRadius: "13px 13px 13px 5px", padding: "11px 15px" }}>
      <div style={{ display: "flex", gap: 5 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: C.inkFaint, animation: `su-bounce 1s ${i * 0.16}s infinite ease-in-out` }} />
        ))}
      </div>
    </div>
  );
}
