-- ============================================================================
-- AANU — Supabase Schema + Row-Level Security
-- Run this in Supabase Studio: SQL Editor -> New Query -> paste -> Run
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. vault_meta — per-user key derivation parameters (NOT the key itself)
-- ---------------------------------------------------------------------------
create table if not exists vault_meta (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  salt               text not null,             -- base64, PBKDF2 salt (not secret)
  pbkdf2_iterations  integer not null default 600000,
  wrapped_key_iv     text,                       -- base64 IV for the wrapped master key (nullable until passkey set up)
  wrapped_key        text,                       -- base64 AES-GCM-wrapped master key (ciphertext, safe to store)
  passkey_credential_id text,                    -- WebAuthn credential id used for biometric unlock
  canary_iv          text,                       -- base64 IV for the "is this password correct" check value
  canary_ciphertext  text,                       -- base64 ciphertext of a known constant, encrypted with the master key
  created_at         timestamptz not null default now()
);

alter table vault_meta enable row level security;

create policy "select own vault_meta"
  on vault_meta for select
  using (auth.uid() = user_id);

create policy "insert own vault_meta"
  on vault_meta for insert
  with check (auth.uid() = user_id);

create policy "update own vault_meta"
  on vault_meta for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. vault_notes — Secure Notes (fully encrypted client-side)
-- ---------------------------------------------------------------------------
create table if not exists vault_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  iv          text not null,
  ciphertext  text not null,
  updated_at  timestamptz not null default now()
);

alter table vault_notes enable row level security;

create policy "own notes select" on vault_notes for select using (auth.uid() = user_id);
create policy "own notes insert" on vault_notes for insert with check (auth.uid() = user_id);
create policy "own notes update" on vault_notes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own notes delete" on vault_notes for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. vault_passwords — Password Manager entries (fully encrypted client-side)
-- ---------------------------------------------------------------------------
create table if not exists vault_passwords (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  iv          text not null,
  ciphertext  text not null,
  updated_at  timestamptz not null default now()
);

alter table vault_passwords enable row level security;

create policy "own pw select" on vault_passwords for select using (auth.uid() = user_id);
create policy "own pw insert" on vault_passwords for insert with check (auth.uid() = user_id);
create policy "own pw update" on vault_passwords for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own pw delete" on vault_passwords for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. vault_files — encrypted file METADATA (name/size/mime); the encrypted
--    blob itself lives in Supabase Storage, keyed by this row's id.
-- ---------------------------------------------------------------------------
create table if not exists vault_files (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  iv          text not null,
  ciphertext  text not null,   -- encrypted JSON: { name, size, mime }
  updated_at  timestamptz not null default now()
);

alter table vault_files enable row level security;

create policy "own files select" on vault_files for select using (auth.uid() = user_id);
create policy "own files insert" on vault_files for insert with check (auth.uid() = user_id);
create policy "own files update" on vault_files for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own files delete" on vault_files for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 5. Storage bucket + policies — the actual encrypted file bytes.
--    Files are stored at path `{user_id}/{file_id}`, so the folder name
--    itself doubles as the access-control boundary.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('vault-files', 'vault-files', false)
on conflict (id) do nothing;

create policy "own storage select"
  on storage.objects for select
  using (bucket_id = 'vault-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own storage insert"
  on storage.objects for insert
  with check (bucket_id = 'vault-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own storage update"
  on storage.objects for update
  using (bucket_id = 'vault-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own storage delete"
  on storage.objects for delete
  using (bucket_id = 'vault-files' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Notes:
--  - No table above ever stores a plaintext column, the master password, or
--    a usable decryption key. `wrapped_key` in vault_meta is AES-GCM
--    ciphertext that only decrypts with a secret derived from the user's
--    own WebAuthn passkey (see lib/webauthn.js + lib/crypto.js).
--  - RLS means even if your anon/service key leaked, a request still can't
--    read another user's rows — but always keep the service_role key
--    server-side only and never in client code.
-- ============================================================================
