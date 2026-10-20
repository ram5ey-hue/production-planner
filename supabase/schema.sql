-- Production Planner — database schema
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- DEMO SECURITY: anyone with the page link can read and edit. Use invented data only.
-- Before real use, switch on Supabase Auth and replace the "demo_open" policies.

create table if not exists tasks (
  ref        text primary key,
  title      text not null,
  hrs        jsonb not null default '{"Mech":0,"B1":0,"B2":0}',
  tooling    jsonb not null default '[]',
  materials  jsonb not null default '[]',
  flags      jsonb not null default '{}',
  ind        boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists packs (
  id          text primary key,
  ac          text not null,
  check_type  text not null,
  start_date  date not null,
  days        int  not null default 1,
  version     int  not null default 1,
  status      text not null default 'Planning' check (status in ('Planning','In work','Closed')),
  checks      jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);

create table if not exists work_orders (
  no         text primary key,
  pack_id    text not null references packs(id) on delete cascade,
  ref        text,
  type       text not null check (type in ('OMP','ADF')),
  title      text not null,
  hrs        jsonb not null default '{"Mech":0,"B1":0,"B2":0}',
  flags      jsonb not null default '{}',
  added_v    int  not null default 1,
  removed_v  int,
  decision   text not null default 'Pending' check (decision in ('Pending','Accepted','Rejected','G703')),
  comment    text not null default '',
  parts      jsonb not null default '[]',
  tools      jsonb not null default '[]',
  progress   text not null default 'Not started' check (progress in ('Not started','In progress','Complete','Passed back')),
  assignee   text not null default '',
  actual     jsonb not null default '{}',
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
-- for databases created before these columns existed
alter table work_orders add column if not exists started_at timestamptz;
alter table work_orders add column if not exists completed_at timestamptz;
alter table work_orders add column if not exists run_from timestamptz;
alter table work_orders add column if not exists worked_min numeric not null default 0;
alter table work_orders add column if not exists paused_at timestamptz;
alter table work_orders add column if not exists pause_reason text;
alter table work_orders add column if not exists pause_log jsonb not null default '[]';
create index if not exists work_orders_pack on work_orders(pack_id);

create table if not exists escapes (
  id        bigint generated always as identity primary key,
  date      date not null default current_date,
  pack_id   text,
  ref       text,
  raised_by text,
  type      text,
  detail    text not null,
  action    text not null default '',
  done      boolean not null default false
);

create table if not exists handover (
  id     bigint generated always as identity primary key,
  level  text not null check (level in ('wp','145','mp')),
  ref    text not null,
  issue  text not null,
  plan   text not null default '',
  role   text,
  date   date not null default current_date,
  done   boolean not null default false
);

create table if not exists history (
  id         text primary key,
  ac         text not null,
  check_type text not null,
  end_date   date not null,
  planned    jsonb not null,
  actual     jsonb not null,
  wos        int not null,
  done       int not null,
  adf        int not null default 0,
  esc        int not null default 0,
  late       int not null default 0
);

create table if not exists roster (
  id      int primary key default 1,
  weekday jsonb not null default '{"Mech":10,"B1":5,"B2":3}',
  weekend jsonb not null default '{"Mech":6,"B1":3,"B2":2}',
  prod    numeric not null default 6.5
);

create table if not exists activity (
  id      bigint generated always as identity primary key,
  t       timestamptz not null default now(),
  role    text,
  actor   text,
  pack_id text,
  text    text not null
);

-- Keep updated_at current
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists tasks_touch on tasks;
create trigger tasks_touch before update on tasks for each row execute function touch_updated_at();
drop trigger if exists wo_touch on work_orders;
create trigger wo_touch before update on work_orders for each row execute function touch_updated_at();

-- Demo access: open read/write for the publishable key
do $$
declare t text;
begin
  foreach t in array array['tasks','packs','work_orders','escapes','handover','history','roster','activity'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists demo_open on %I', t);
    execute format('create policy demo_open on %I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Live updates to every open page
do $$
declare t text;
begin
  foreach t in array array['tasks','packs','work_orders','escapes','handover','history','roster','activity'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
