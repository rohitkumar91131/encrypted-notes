-- Run once in Supabase Dashboard → SQL Editor.
-- Note bodies and per-note keys are encrypted in the browser before insertion.
create table if not exists public.encrypted_notes (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ciphertext text not null,
  nonce text not null,
  wrapped_key text not null,
  key_nonce text not null,
  format_version smallint not null default 1,
  updated_at timestamptz not null default now()
);

-- Existing notes can be upgraded in place; title stays plaintext, note blocks remain encrypted.
alter table public.encrypted_notes add column if not exists title text not null default 'Untitled';

alter table public.encrypted_notes enable row level security;
revoke all on public.encrypted_notes from anon;
grant select, insert, update, delete on public.encrypted_notes to authenticated;

drop policy if exists "Users can read their encrypted notes" on public.encrypted_notes;
create policy "Users can read their encrypted notes"
  on public.encrypted_notes for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Users can create their encrypted notes" on public.encrypted_notes;
create policy "Users can create their encrypted notes"
  on public.encrypted_notes for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update their encrypted notes" on public.encrypted_notes;
create policy "Users can update their encrypted notes"
  on public.encrypted_notes for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their encrypted notes" on public.encrypted_notes;
create policy "Users can delete their encrypted notes"
  on public.encrypted_notes for delete to authenticated
  using ((select auth.uid()) = user_id);

do $$ begin
  alter publication supabase_realtime add table public.encrypted_notes;
exception when duplicate_object then null;
end $$;

-- Helps account-scoped note/thread listings; does not change encrypted contents.
create index if not exists encrypted_notes_user_updated_idx
  on public.encrypted_notes (user_id, updated_at desc);
