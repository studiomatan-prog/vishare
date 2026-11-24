-- VISHARE database schema (Supabase / Postgres)
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- All tables have Row Level Security ON and no policies: only the Worker,
-- using the service-role key, can read or write. Browsers never talk to Supabase directly.

create extension if not exists pgcrypto;

create table if not exists events (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,              -- used in the guest link: vishare.co.il/e/<slug>
  couple_names     text not null,                     -- "דנה ודוד"
  event_type       text not null default 'חתונה',
  event_date       date not null,
  venue            text,
  package          text not null default 'פרימיום',
  invited_count    int  not null default 0,
  upload_closes_at timestamptz not null,              -- after this, uploads are refused and auto-edit starts
  couple_token_hash text not null unique,             -- sha256 of the couple's private link token
  status           text not null default 'pre'
                   check (status in ('pre','live','open','edit','done')),
  created_at       timestamptz not null default now()
);

create table if not exists guests (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  name        text not null,
  phone       text not null,                          -- digits only, e.g. 0501234567
  token_hash  text not null unique,                   -- sha256 of the token kept on the guest's phone
  created_at  timestamptz not null default now()
);
create index if not exists guests_event_idx on guests(event_id);

create table if not exists videos (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  guest_id      uuid not null references guests(id) on delete cascade,
  kind          text not null default 'clip' check (kind in ('clip','greeting')),
  moment        text,                                 -- optional tag chosen by the guest
  r2_key        text not null unique,
  file_name     text,
  content_type  text,
  size_bytes    bigint,
  status        text not null default 'pending'
                check (status in ('pending','uploaded','deleted')),
  created_at    timestamptz not null default now(),
  uploaded_at   timestamptz,
  deleted_at    timestamptz
);
create index if not exists videos_event_idx on videos(event_id, status);
create index if not exists videos_guest_idx on videos(guest_id, status);

-- Edited videos produced by the auto-edit pipeline, waiting for LOCO approval.
create table if not exists edits (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  moment      text not null,                          -- חופה / ברכות / ריקודים / סלואו / צילומי חוץ
  r2_key      text,
  status      text not null default 'waiting'
              check (status in ('waiting','draft','approved','sent')),
  created_at  timestamptz not null default now(),
  approved_at timestamptz,
  sent_at     timestamptz
);

alter table events enable row level security;
alter table guests enable row level security;
alter table videos enable row level security;
alter table edits  enable row level security;
