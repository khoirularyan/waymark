create extension if not exists pgcrypto;

create table public.tracking_sessions (
  id uuid primary key default gen_random_uuid(),
  share_token uuid not null unique default gen_random_uuid(),
  runner_name text not null check (char_length(runner_name) between 1 and 80),
  event_name text not null check (char_length(event_name) between 1 and 160),
  status text not null default 'draft' check (status in ('draft', 'live', 'stopped', 'revoked')),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint valid_session_times check (finished_at is null or started_at is null or finished_at >= started_at)
);

create table public.tracking_locations (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.tracking_sessions(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy real check (accuracy is null or accuracy >= 0),
  battery integer check (battery is null or battery between 0 and 100),
  recorded_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (session_id, recorded_at)
);

create table public.tracking_routes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.tracking_sessions(id) on delete cascade,
  route_geojson jsonb not null,
  total_distance double precision not null check (total_distance >= 0),
  elevation_gain double precision check (elevation_gain is null or elevation_gain >= 0),
  created_at timestamptz not null default now()
);

create table public.tracking_viewers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tracking_sessions(id) on delete cascade,
  visitor_id text not null check (char_length(visitor_id) between 12 and 120),
  display_name text not null check (char_length(display_name) between 1 and 80),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (session_id, visitor_id)
);

create index locations_session_recorded_idx on public.tracking_locations(session_id, recorded_at);
create index sessions_share_token_idx on public.tracking_sessions(share_token);
create index viewers_active_idx on public.tracking_viewers(session_id, last_seen_at desc);

alter table public.tracking_sessions enable row level security;
alter table public.tracking_locations enable row level security;
alter table public.tracking_routes enable row level security;
alter table public.tracking_viewers enable row level security;

-- All mutations run through server-side API routes using the Supabase service role.
-- Public clients never receive direct table permissions.
