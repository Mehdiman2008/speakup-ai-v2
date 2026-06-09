"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

/* A single browser Supabase client. Returns null if env vars are missing,
   so the app keeps working in pure-localStorage mode without Supabase. */

let client: SupabaseClient | null = null;
let initialised = false;

export function getSupabase(): SupabaseClient | null {
  if (initialised) return client;
  initialised = true;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    client = null;
    return null;
  }
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

export const supabaseEnabled = () =>
  !!(process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY));
