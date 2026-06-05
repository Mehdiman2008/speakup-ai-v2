import type { ErrorEntry, SpeakingDNA } from "./types";

const KEY_ERRORS = "speakup:errorbank";
const KEY_DNA = "speakup:dna";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export const loadErrors = () => read<ErrorEntry[]>(KEY_ERRORS, []);
export const saveErrors = (e: ErrorEntry[]) => write(KEY_ERRORS, e);
export const loadDna = () => read<SpeakingDNA | null>(KEY_DNA, null);
export const saveDna = (d: SpeakingDNA | null) => write(KEY_DNA, d);

export function mergeDna(prev: SpeakingDNA | null, upd: Partial<SpeakingDNA>): SpeakingDNA {
  const cap = (arr: string[]) => Array.from(new Set(arr)).slice(0, 8);
  const m = (a?: string[], b?: string[]) => cap([...(b || []), ...(a || [])]);
  const p = prev || ({} as Partial<SpeakingDNA>);
  return {
    recurringWeaknesses: m(p.recurringWeaknesses, upd.recurringWeaknesses),
    improvingAreas: m(p.improvingAreas, upd.improvingAreas),
    overusedPhrases: m(p.overusedPhrases, upd.overusedPhrases),
    confidenceIssues: m(p.confidenceIssues, upd.confidenceIssues),
    missingSkills: m(p.missingSkills, upd.missingSkills),
    grammarPatterns: m(p.grammarPatterns, upd.grammarPatterns),
    nextFocus: upd.nextFocus || p.nextFocus || "",
    sessions: (p.sessions || 0) + 1,
    updated: new Date().toLocaleDateString(),
  };
}
