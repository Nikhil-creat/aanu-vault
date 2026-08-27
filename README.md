# AANU — Ultimate Vault

**AANU** *(ANANTHA CHARY · AKHIL · NIKHIL · UMA)* is a 100% free, zero-knowledge personal data and file vault. Your notes, passwords, and files are encrypted **in your browser** before they ever reach the server — the host, the database, and the admin can never read your data. Only you can.

## Features

- 🔒 **Secure Notes** — encrypted text notes, readable only by you
- 🔑 **Password Manager** — store site credentials, encrypted client-side
- 📁 **File Vault** — drag-and-drop file upload with client-side encryption before it leaves your device
- 👆 **Biometric unlock** — fingerprint / Face ID via WebAuthn passkeys, no need to retype your master password every time
- ⏱️ **Auto-lock** — vault seals itself after 3 minutes of inactivity
- 🆓 **100% free stack** — Supabase free tier + Vercel free tier

## Zero-Knowledge Architecture

- **Client-side encryption**: AES-256-GCM, performed entirely in the browser via the Web Crypto API
- **Key derivation**: Master Password + unique salt → PBKDF2-SHA256 (600,000 iterations) → encryption key
- **Biometric unlock**: WebAuthn PRF extension derives a hardware-backed secret that unseals the encryption key locally — the key itself never leaves your device
- **No key transmission**: the encryption key is never sent to Supabase or any API — the server only ever stores ciphertext

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), Tailwind CSS, Framer Motion, Lucide Icons |
| Encryption | Web Crypto API (AES-256-GCM + PBKDF2) |
| Auth / Biometrics | Supabase Auth + WebAuthn / Passkeys |
| Backend | Supabase (Database + Storage, with Row-Level Security) |
| Hosting | Vercel |

## Getting Started

See [`SETUP_GUIDE.md`](./SETUP_GUIDE.md) for full Supabase + Vercel setup instructions.

```bash
npm install
cp .env.local.example .env.local   # add your Supabase URL + anon key
npm run dev

