-- Migration: 202611110002_runner_and_cheers.sql
-- Enables persistent runner identity without requiring registration/login,
-- and permanently stores cheer messages and voice notes (audio data).

-- 1. Runner identity table
create table if not exists public.tracking_runners (
  id text primary key,
  runner_name text not null default 'Waymark Runner',
  active_session_id uuid references public.tracking_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Add runner_id to tracking_sessions
alter table public.tracking_sessions 
add column if not exists runner_id text references public.tracking_runners(id) on delete set null;

-- 3. Persistent cheers table (storing text, emojis, and voice notes)
create table if not exists public.tracking_cheers (
  id text primary key,
  session_id uuid references public.tracking_sessions(id) on delete cascade,
  runner_id text references public.tracking_runners(id) on delete set null,
  sender_name text not null default 'Penonton',
  emoji text default '👏',
  message text,
  audio_data text,
  duration_seconds integer,
  created_at timestamptz not null default now()
);

-- 4. Fast lookup indexes
create index if not exists tracking_runners_active_session_idx on public.tracking_runners(active_session_id);
create index if not exists tracking_sessions_runner_id_idx on public.tracking_sessions(runner_id);
create index if not exists tracking_cheers_session_id_idx on public.tracking_cheers(session_id, created_at desc);
create index if not exists tracking_cheers_runner_id_idx on public.tracking_cheers(runner_id, created_at desc);

-- 5. RLS Setup (API routes use Supabase service role which bypasses RLS)
alter table public.tracking_runners enable row level security;
alter table public.tracking_cheers enable row level security;
