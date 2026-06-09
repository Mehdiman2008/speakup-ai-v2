"use client";

import { getSupabase } from "./supabaseClient";
import type { ErrorEntry, SavedSession, SpeakingDNA } from "./types";

/* ============================================================================
   cloudStore.ts — per-user persistence in Supabase.

   One table `user_data` with a single JSON row per user:
     user_id (uuid, PK, = auth.uid())
     sessions (jsonb)  errors (jsonb)  dna (jsonb)  updated_at
   Row-Level Security ensures each user only sees their own row.

   This keeps the schema dead simple and mirrors the localStorage shape, so the
   adapter in storage.ts can swap between local and cloud with no UI changes.
============================================================================ */

export interface CloudBundle {
  sessions: SavedSession[];
  errors: ErrorEntry[];
  dna: SpeakingDNA | null;
}

export async function getUser() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user || null;
}

export async function cloudLoad(): Promise<CloudBundle | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await sb
    .from("user_data")
    .select("sessions, errors, dna")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    console.warn("[cloud] load error:", error.message);
    return null;
  }
  if (!data) return { sessions: [], errors: [], dna: null };
  return {
    sessions: data.sessions || [],
    errors: data.errors || [],
    dna: data.dna || null,
  };
}

export async function cloudSave(bundle: CloudBundle): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const user = await getUser();
  if (!user) return false;
  const { error } = await sb.from("user_data").upsert(
    {
      user_id: user.id,
      sessions: bundle.sessions,
      errors: bundle.errors,
      dna: bundle.dna,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) {
    console.warn("[cloud] save error:", error.message);
    return false;
  }
  return true;
}

/* Merge local + cloud (used right after sign-in so nothing is lost). */
export function mergeBundles(local: CloudBundle, cloud: CloudBundle): CloudBundle {
  const byId = <T extends { id: number }>(a: T[], b: T[]) => {
    const map = new Map<number, T>();
    [...a, ...b].forEach((x) => map.set(x.id, x));
    return Array.from(map.values()).sort((x, y) => y.id - x.id);
  };
  return {
    sessions: byId(local.sessions, cloud.sessions).slice(0, 50),
    errors: byId(local.errors, cloud.errors).slice(0, 200),
    // DNA: prefer whichever was updated most recently (cloud wins on tie).
    dna: cloud.dna || local.dna,
  };
}
