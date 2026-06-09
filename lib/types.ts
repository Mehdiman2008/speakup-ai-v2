export type ModeId = "realistic" | "silver" | "titanium" | "gold";

// Coaching output types — each can be routed to a different model.
export type OutputType =
  | "roleplay"
  | "grammarScore"
  | "naturalnessScore"
  | "correction"
  | "naturalVersion"
  | "coachNote"
  | "options"
  | "endFeedback"
  | "help";

export interface Scenario {
  description: string;
  myRole: string;
  aiRole: string;
  goal: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  hidden?: boolean;
}

export interface ErrorEntry {
  id: number;
  date: string;
  scenario: string;
  mySentence: string;
  correct: string;
  natural: string;
  notes?: string;
}

export interface SpeakingDNA {
  recurringWeaknesses: string[];
  improvingAreas: string[];
  overusedPhrases: string[];
  confidenceIssues: string[];
  missingSkills: string[];
  grammarPatterns: string[];
  nextFocus: string;
  sessions: number;
  updated: string;
}

export interface SavedSession {
  id: number;
  date: string;        // human-readable
  ts: number;          // sort key
  mode: ModeId;
  scenario: Scenario;
  messages: ChatMessage[]; // includes hidden opener; UI filters it
  durationSec: number;
}
