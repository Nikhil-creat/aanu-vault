"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Fingerprint, Lock, ShieldCheck, Loader2 } from "lucide-react";
import { supabase, getUserVaultMeta, upsertVaultMeta } from "../lib/supabase";
import {
  deriveMasterKey,
  generateSalt,
  encrypt,
  decryptToString,
  toB64,
  importWrappingKey,
  wrapMasterKey,
  unwrapMasterKey,
} from "../lib/crypto";
import {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  registerPasskey,
  authenticatePasskey,
} from "../lib/webauthn";
import VaultDashboard from "../components/VaultDashboard";

const RP_ID = typeof window !== "undefined" ? window.location.hostname : "localhost";
const CANARY = "AANU-VERIFIED-V1";

// Screens: "loading" | "auth" | "setup" | "locked" | "unlocked"
export default function Page() {
  const [screen, setScreen] = useState("loading");
  const [session, setSession] = useState(null);
  const [vaultMeta, setVaultMeta] = useState(null);
  const [masterKey, setMasterKey] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    isPlatformAuthenticatorAvailable().then(setBiometricAvailable);
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setScreen((s) => (s === "unlocked" ? s : "auth"));
      return;
    }
    (async () => {
      const { data, error: e } = await supabase
        .from("vault_meta")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (e) {
        setError(e.message);
        return;
      }
      setVaultMeta(data);
      setScreen(data ? "locked" : "setup");
    })();
  }, [session]);

  function onLock() {
    setMasterKey(null); // wipe the in-memory key
    setScreen("locked");
  }

  if (screen === "loading") return <CenteredShell><Loader2 className="animate-spin text-neutral-500" /></CenteredShell>;
  if (screen === "auth") return <AuthScreen onError={setError} error={error} />;
  if (screen === "setup")
    return (
      <SetupScreen
        userId={session.user.id}
        biometricAvailable={biometricAvailable}
        busy={busy}
        setBusy={setBusy}
        error={error}
        setError={setError}
        onComplete={(meta, key) => {
          setVaultMeta(meta);
          setMasterKey(key);
          setScreen("unlocked");
        }}
      />
    );
  if (screen === "locked")
    return (
      <LockScreen
        userId={session.user.id}
        vaultMeta={vaultMeta}
        biometricAvailable={biometricAvailable}
        busy={busy}
        setBusy={setBusy}
        error={error}
        setError={setError}
        onUnlock={(key) => {
          setMasterKey(key);
          setScreen("unlocked");
        }}
      />
    );

  return <VaultDashboard userId={session.user.id} masterKey={masterKey} onLock={onLock} />;
}

// ---------------------------------------------------------------------------
function CenteredShell({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0f1a]">{children}</div>
  );
}

function Brand() {
  return (
    <div className="mb-8 flex flex-col items-center gap-3">
      <div className="rounded-2xl bg-white p-3 shadow-[0_0_40px_-8px_rgba(34,211,238,0.35)]">
        <img src="/aanu-icon.png" alt="AANU" className="h-14 w-14 object-contain" />
      </div>
      <h1 className="text-lg font-semibold tracking-tight text-neutral-100">AANU</h1>
      <p className="text-xs text-neutral-500">Ultimate Vault — zero-knowledge, always</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account auth (Supabase Auth) — separate from the vault Master Password.
// This only establishes *who you are* so RLS can scope rows to auth.uid();
// it grants no access whatsoever to encrypted vault contents.
// ---------------------------------------------------------------------------
function AuthScreen({ error, onError }) {
  const [mode, setMode] = useState("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const submit = async () => {
    setBusy(true);
    onError("");
    setNotice("");
    const fn = mode === "sign-in" ? supabase.auth.signInWithPassword : supabase.auth.signUp;
    const { error: e } = await fn({ email, password });
    if (e) onError(e.message);
    else if (mode === "sign-up") setNotice("Check your inbox to confirm your email, then sign in.");
    setBusy(false);
  };

  return (
    <CenteredShell>
      <div className="w-full max-w-sm rounded-2xl border border-white/5 bg-[#101826] p-8">
        <Brand />
        <div className="space-y-3">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-lg bg-white/5 px-3 py-2.5 text-sm outline-none placeholder:text-neutral-600"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Account password"
            className="w-full rounded-lg bg-white/5 px-3 py-2.5 text-sm outline-none placeholder:text-neutral-600"
          />
          {error && <p className="text-xs text-[#c96e4e]">{error}</p>}
          {notice && <p className="text-xs text-neutral-400">{notice}</p>}
          <button
            disabled={busy}
            onClick={submit}
            className="w-full rounded-lg bg-[#22d3ee] py-2.5 text-sm font-medium text-black hover:bg-[#67e8f9] disabled:opacity-50 transition-colors"
          >
            {mode === "sign-in" ? "Sign in" : "Create account"}
          </button>
          <button
            onClick={() => setMode((m) => (m === "sign-in" ? "sign-up" : "sign-in"))}
            className="w-full text-center text-xs text-neutral-500 hover:text-neutral-300"
          >
            {mode === "sign-in" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </CenteredShell>
  );
}

// ---------------------------------------------------------------------------
// First-run setup: choose a Master Password, optionally enroll a passkey
// so future unlocks can use fingerprint/Face ID instead of retyping it.
// ---------------------------------------------------------------------------
function SetupScreen({ userId, biometricAvailable, busy, setBusy, error, setError, onComplete }) {
  const [pw, setPw] = useState("");
  const [confirm, setPw2] = useState("");
  const [wantsBiometric, setWantsBiometric] = useState(biometricAvailable);

  const submit = async () => {
    setError("");
    if (pw.length < 10) return setError("Use at least 10 characters — this key can't be reset if lost.");
    if (pw !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      const salt = generateSalt();
      // Extractable only transiently, in-memory, so we can wrap it for passkey
      // unlock. It's never exported anywhere except into the wrapped blob below.
      const extractableKey = await deriveMasterKey(pw, salt, { extractable: true });
      const canary = await encrypt(extractableKey, CANARY);

      const meta = {
        salt: toB64(salt),
        pbkdf2_iterations: 600000,
        canary_iv: canary.iv,
        canary_ciphertext: canary.ciphertext,
      };

      if (wantsBiometric && isWebAuthnSupported()) {
        const reg = await registerPasskey({
          rpId: RP_ID,
          userId,
          userName: "aanu-user",
        });
        if (reg.prfSupported) {
          const auth = await authenticatePasskey({ rpId: RP_ID, credentialId: reg.credentialId });
          if (auth.prfSecret) {
            const wrappingKey = await importWrappingKey(auth.prfSecret);
            const wrapped = await wrapMasterKey(extractableKey, wrappingKey);
            meta.passkey_credential_id = reg.credentialId;
            meta.wrapped_key_iv = wrapped.iv;
            meta.wrapped_key = wrapped.wrapped;
          }
        }
      }

      await upsertVaultMeta(userId, meta);
      const finalKey = await deriveMasterKey(pw, salt, { extractable: false });
      onComplete(meta, finalKey);
    } catch (e) {
      setError(e.message || "Setup failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CenteredShell>
      <div className="w-full max-w-sm rounded-2xl border border-white/5 bg-[#101826] p-8">
        <Brand />
        <p className="mb-4 text-center text-xs text-neutral-500">
          Choose a Master Password. It's derived into your encryption key on
          this device — AANU's servers never see it and can't reset it.
        </p>
        <div className="space-y-3">
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="Master Password"
            className="w-full rounded-lg bg-white/5 px-3 py-2.5 text-sm outline-none placeholder:text-neutral-600"
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setPw2(e.target.value)}
            placeholder="Confirm Master Password"
            className="w-full rounded-lg bg-white/5 px-3 py-2.5 text-sm outline-none placeholder:text-neutral-600"
          />
          {biometricAvailable && (
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input
                type="checkbox"
                checked={wantsBiometric}
                onChange={(e) => setWantsBiometric(e.target.checked)}
              />
              Enable fingerprint / Face ID unlock on this device
            </label>
          )}
          {error && <p className="text-xs text-[#c96e4e]">{error}</p>}
          <button
            disabled={busy}
            onClick={submit}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#22d3ee] py-2.5 text-sm font-medium text-black hover:bg-[#67e8f9] disabled:opacity-50 transition-colors"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            Seal the vault
          </button>
        </div>
      </div>
    </CenteredShell>
  );
}

// ---------------------------------------------------------------------------
// Returning-user unlock: biometric-first, master password always available
// as a fallback (and required if this is a new device with no passkey).
// ---------------------------------------------------------------------------
function LockScreen({ userId, vaultMeta, biometricAvailable, busy, setBusy, error, setError, onUnlock }) {
  const [showPasswordForm, setShowPasswordForm] = useState(!vaultMeta?.passkey_credential_id);
  const [pw, setPw] = useState("");

  const unlockWithBiometrics = async () => {
    setError("");
    setBusy(true);
    try {
      const auth = await authenticatePasskey({
        rpId: RP_ID,
        credentialId: vaultMeta.passkey_credential_id,
      });
      if (!auth.prfSecret) throw new Error("This device can't use biometric unlock — use your Master Password.");
      const wrappingKey = await importWrappingKey(auth.prfSecret);
      const key = await unwrapMasterKey(
        { iv: vaultMeta.wrapped_key_iv, wrapped: vaultMeta.wrapped_key },
        wrappingKey
      );
      onUnlock(key);
    } catch (e) {
      setError(e.message || "Fingerprint unlock failed. Try your Master Password.");
      setShowPasswordForm(true);
    } finally {
      setBusy(false);
    }
  };

  const unlockWithPassword = async () => {
    setError("");
    setBusy(true);
    try {
      const salt = Uint8Array.from(atob(vaultMeta.salt), (c) => c.charCodeAt(0));
      const key = await deriveMasterKey(pw, salt, { extractable: false });
      // Verify against the canary before trusting this key with real data.
      const check = await decryptToString(key, {
        iv: vaultMeta.canary_iv,
        ciphertext: vaultMeta.canary_ciphertext,
      }).catch(() => null);
      if (check !== CANARY) throw new Error("Incorrect Master Password.");
      onUnlock(key);
    } catch (e) {
      setError(e.message || "Incorrect Master Password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CenteredShell>
      <div className="w-full max-w-sm rounded-2xl border border-white/5 bg-[#101826] p-8">
        <Brand />
        <AnimatePresence mode="wait">
          {!showPasswordForm ? (
            <motion.div
              key="bio"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-4"
            >
              <button
                onClick={unlockWithBiometrics}
                disabled={busy}
                className="flex h-20 w-20 items-center justify-center rounded-full bg-[#22d3ee]/10 text-[#22d3ee] hover:bg-[#22d3ee]/20 transition-colors disabled:opacity-50"
              >
                {busy ? <Loader2 className="animate-spin" size={26} /> : <Fingerprint size={30} />}
              </button>
              <p className="text-xs text-neutral-500">Tap to unlock with fingerprint / Face ID</p>
              {error && <p className="text-xs text-[#c96e4e]">{error}</p>}
              <button
                onClick={() => setShowPasswordForm(true)}
                className="text-xs text-neutral-500 hover:text-neutral-300 underline underline-offset-2"
              >
                Use Master Password instead
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="pw"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && unlockWithPassword()}
                placeholder="Master Password"
                autoFocus
                className="w-full rounded-lg bg-white/5 px-3 py-2.5 text-sm outline-none placeholder:text-neutral-600"
              />
              {error && <p className="text-xs text-[#c96e4e]">{error}</p>}
              <button
                disabled={busy}
                onClick={unlockWithPassword}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#22d3ee] py-2.5 text-sm font-medium text-black hover:bg-[#67e8f9] disabled:opacity-50 transition-colors"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                Unlock vault
              </button>
              {vaultMeta?.passkey_credential_id && (
                <button
                  onClick={() => setShowPasswordForm(false)}
                  className="w-full text-center text-xs text-neutral-500 hover:text-neutral-300"
                >
                  Use fingerprint instead
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </CenteredShell>
  );
}
