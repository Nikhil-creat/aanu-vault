# AANU — Setup & Deployment Guide

A zero-knowledge personal vault: notes, passwords, and files, encrypted in
your browser before anything leaves your device. This guide gets you from
zero to a live, working deployment on 100% free tiers.

**Honest framing first:** "zero-knowledge server" is a real, verifiable
property of this architecture — Supabase and Vercel only ever store/see
ciphertext. It does not mean "unhackable" in an absolute sense. Your
biggest remaining risks are the same as for any account: a phished master
password, a compromised browser/device, or losing the master password
with no passkey enrolled anywhere (there is no "forgot password" — that's
the tradeoff for real zero-knowledge).

---

## 1. Create the Supabase project

1. Go to supabase.com → **New project** (free tier).
2. Note your **Project URL** and **anon public key** (Settings → API) —
   you'll need these for `.env.local`.
3. Go to **Authentication → Providers** and make sure **Email** is
   enabled. For a first personal deployment you can disable "Confirm
   email" under Authentication → Settings if you want to skip inbox
   confirmation while testing.
4. Go to **SQL Editor → New query**, paste the entire contents of
   `supabase/schema.sql` from this project, and click **Run**.
   This creates:
   - `vault_meta`, `vault_notes`, `vault_passwords`, `vault_files` tables
   - Row-Level Security policies scoping every row to `auth.uid()`
   - The `vault-files` storage bucket + matching storage policies
5. Verify RLS is on: **Table Editor** → each table should show a
   "RLS enabled" badge. If any table doesn't, re-run the relevant
   `alter table ... enable row level security;` line.

## 2. Configure the app locally

```bash
git clone <your-repo>   # or unzip the delivered project
cd aanu
cp .env.local.example .env.local
```

Edit `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

Install and run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. WebAuthn/passkeys require either `localhost`
or HTTPS — plain HTTP on a non-localhost address will silently fail, so
test biometric unlock on `localhost` or your real Vercel domain, not a
LAN IP.

## 3. Deploy to Vercel (free tier)

1. Push the project to a GitHub repo.
2. In Vercel: **Add New → Project**, import the repo.
3. Under **Environment Variables**, add the same two variables from
   `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
4. Deploy. Vercel gives you an HTTPS domain automatically — required for
   WebAuthn in production.
5. Back in Supabase → **Authentication → URL Configuration**, add your
   Vercel domain to **Site URL** and **Redirect URLs** so email
   confirmation links work.

## 4. First run, per user

1. Visit the app → sign up with an email + account password (this is
   just your Supabase login, unrelated to vault encryption).
2. Confirm the email if confirmation is enabled.
3. Sign in → you'll land on **"Seal the vault"**: choose a **Master
   Password**. This is the only secret that can ever decrypt your data,
   and AANU's servers never receive it. Write it down somewhere safe —
   there is no reset flow, by design.
4. If your device has a fingerprint/Face ID sensor, tick **"Enable
   fingerprint unlock"** — this registers a passkey and seals your
   Master Key behind it via the WebAuthn PRF extension, so future
   unlocks are one tap instead of retyping the password.
5. You're in. Auto-lock kicks in after 3 minutes idle; the ring in the
   top bar shows time remaining.

## 5. Browser/OS support notes for biometric unlock

- PRF-based passkey unlock works on current Chrome/Edge (Windows Hello,
  Android fingerprint) and Safari on iOS 17+/macOS 14+.
- On unsupported browsers, AANU automatically falls back to
  password-only unlock — nothing breaks, it's just less seamless.
- Passkeys tied to a platform authenticator (Face ID, Windows Hello) may
  sync across a user's own devices via iCloud Keychain / Google Password
  Manager, in which case biometric unlock can "just work" on a second
  device too — this is controlled by the OS/browser, not by AANU.

## 6. Ongoing costs

Everything here fits inside Supabase's free tier (500MB database,
1GB file storage, 50k monthly active users) and Vercel's free hobby
tier. If your file storage needs exceed 1GB, that's the first thing
you'll need to upgrade — encryption overhead is roughly 40 bytes per
4MB chunk, effectively free.
