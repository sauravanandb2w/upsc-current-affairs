-- Migration for existing CA Supabase projects (run after initial schema.sql)
-- Adds locks, item meta (stars), git notes sync column

alter table public.ca_item_notes
  add column if not exists locked_fields jsonb not null default '{}'::jsonb;

alter table public.ca_item_notes
  add column if not exists git_notes_json jsonb not null default '{}'::jsonb;

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

-- Refresh PostgREST schema cache so sync sees new columns immediately
notify pgrst, 'reload schema';
