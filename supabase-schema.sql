-- ============================================================================
-- SpeakUp AI — Supabase schema
-- Run this once in your Supabase project: Dashboard -> SQL Editor -> New query.
-- ============================================================================

create table if not exists public.user_data (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  sessions   jsonb not null default '[]'::jsonb,
  errors     jsonb not null default '[]'::jsonb,
  dna        jsonb,
  updated_at timestamptz not null default now()
);

-- Row-Level Security: each user can only read/write their own row.
alter table public.user_data enable row level security;

drop policy if exists "own row select" on public.user_data;
create policy "own row select" on public.user_data
  for select using (auth.uid() = user_id);

drop policy if exists "own row insert" on public.user_data;
create policy "own row insert" on public.user_data
  for insert with check (auth.uid() = user_id);

drop policy if exists "own row update" on public.user_data;
create policy "own row update" on public.user_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
