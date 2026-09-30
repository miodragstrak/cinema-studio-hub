-- #Cinema Studios Studio Hub: database setup.
-- Run once in Supabase → SQL Editor.

create table if not exists public.jobs (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.brokerages (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.settings (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Only signed-in team members can read or write. Nothing is public.
alter table public.jobs enable row level security;
alter table public.brokerages enable row level security;
alter table public.settings enable row level security;

drop policy if exists "team access" on public.jobs;
drop policy if exists "team access" on public.brokerages;
drop policy if exists "team access" on public.settings;
create policy "team access" on public.jobs for all to authenticated using (true) with check (true);
create policy "team access" on public.brokerages for all to authenticated using (true) with check (true);
create policy "team access" on public.settings for all to authenticated using (true) with check (true);

-- Live updates between teammates.
alter publication supabase_realtime add table public.jobs, public.brokerages, public.settings;
