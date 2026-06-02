-- UPSC Current Affairs — Supabase schema (NEW project for CA only)
-- Dashboard → SQL Editor → paste & run

-- Cloud-synced fields only: summary, links, sources (see SCHEMA.md)
-- Large notes live in git (notes.md)

create table if not exists public.ca_item_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade not null,
  item_id text not null,
  summary text not null default '',
  links_json jsonb not null default '[]'::jsonb,
  sources_json jsonb not null default '[]'::jsonb,
  locked_fields jsonb not null default '{}'::jsonb,
  git_notes_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, item_id)
);

create index if not exists ca_item_notes_user_idx
  on public.ca_item_notes (user_id);

create index if not exists ca_item_notes_item_idx
  on public.ca_item_notes (item_id);

-- Optional flashcards for monthly revision
create table if not exists public.ca_flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade not null,
  item_id text not null,
  question text not null default '',
  answer text not null default '',
  month text,
  tags text[] not null default '{}',
  next_review_at timestamptz,
  ease real not null default 2.5,
  interval_days int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ca_flashcards_user_month_idx
  on public.ca_flashcards (user_id, month);

-- Stars + last revised (sync across devices)
create table if not exists public.ca_item_meta (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade not null,
  item_id text not null,
  starred boolean not null default false,
  last_revised_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, item_id)
);

create index if not exists ca_item_meta_user_idx on public.ca_item_meta (user_id);

drop trigger if exists ca_item_meta_updated_at on public.ca_item_meta;
create trigger ca_item_meta_updated_at
  before update on public.ca_item_meta
  for each row execute function public.set_updated_at();

alter table public.ca_item_meta enable row level security;

drop policy if exists "ca_item_meta_select_own" on public.ca_item_meta;
drop policy if exists "ca_item_meta_insert_own" on public.ca_item_meta;
drop policy if exists "ca_item_meta_update_own" on public.ca_item_meta;
drop policy if exists "ca_item_meta_delete_own" on public.ca_item_meta;

create policy "ca_item_meta_select_own"
  on public.ca_item_meta for select using (auth.uid() = user_id);
create policy "ca_item_meta_insert_own"
  on public.ca_item_meta for insert with check (auth.uid() = user_id);
create policy "ca_item_meta_update_own"
  on public.ca_item_meta for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ca_item_meta_delete_own"
  on public.ca_item_meta for delete using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ca_item_notes_updated_at on public.ca_item_notes;
create trigger ca_item_notes_updated_at
  before update on public.ca_item_notes
  for each row execute function public.set_updated_at();

drop trigger if exists ca_flashcards_updated_at on public.ca_flashcards;
create trigger ca_flashcards_updated_at
  before update on public.ca_flashcards
  for each row execute function public.set_updated_at();

alter table public.ca_item_notes enable row level security;
alter table public.ca_flashcards enable row level security;

drop policy if exists "ca_item_notes_select_own" on public.ca_item_notes;
drop policy if exists "ca_item_notes_insert_own" on public.ca_item_notes;
drop policy if exists "ca_item_notes_update_own" on public.ca_item_notes;
drop policy if exists "ca_item_notes_delete_own" on public.ca_item_notes;

create policy "ca_item_notes_select_own"
  on public.ca_item_notes for select using (auth.uid() = user_id);
create policy "ca_item_notes_insert_own"
  on public.ca_item_notes for insert with check (auth.uid() = user_id);
create policy "ca_item_notes_update_own"
  on public.ca_item_notes for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ca_item_notes_delete_own"
  on public.ca_item_notes for delete using (auth.uid() = user_id);

drop policy if exists "ca_flashcards_select_own" on public.ca_flashcards;
drop policy if exists "ca_flashcards_insert_own" on public.ca_flashcards;
drop policy if exists "ca_flashcards_update_own" on public.ca_flashcards;
drop policy if exists "ca_flashcards_delete_own" on public.ca_flashcards;

create policy "ca_flashcards_select_own"
  on public.ca_flashcards for select using (auth.uid() = user_id);
create policy "ca_flashcards_insert_own"
  on public.ca_flashcards for insert with check (auth.uid() = user_id);
create policy "ca_flashcards_update_own"
  on public.ca_flashcards for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ca_flashcards_delete_own"
  on public.ca_flashcards for delete using (auth.uid() = user_id);
