/**
 * lib/webauthn.js
 * ---------------------------------------------------------------------------
 * AANU — Passkey / Biometric Unlock Layer
 * ---------------------------------------------------------------------------
 * WebAuthn on its own is an AUTHENTICATION protocol — a signed assertion
 * that proves "the fingerprint/FaceID gate on this device said yes". It does
 * NOT hand you a secret you can encrypt with. To get a real hardware-backed
 * *secret* (needed so biometrics can unseal the Master Key without retyping
 * the password every time) we use the WebAuthn Level 3 "prf" extension,
 * which is supported on current Chrome, Edge, and Safari (iOS 17+/macOS 14+)
 * platform authenticators as of 2026.
 *
 * If PRF isn't available (older browser/OS), AANU falls back to:
 *   Passkey assertion = "possession + biometric" gate only, and the user
 *   still enters the Master Password to actually derive the key. This is
 *   clearly surfaced in the UI — see VaultDashboard's `unlockMode`.
 * ---------------------------------------------------------------------------
 */

const RP_NAME = "AANU Vault";
// Fixed, non-secret application-level salt for domain-separating the PRF
// evaluation. It does not need to be secret — it only needs to be stable.
const PRF_SALT = new TextEncoder().encode("aanu-prf-salt-v1");

export function isWebAuthnSupported() {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

export async function isPlatformAuthenticatorAvailable() {
  if (!isWebAuthnSupported()) return false;
  return window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
}

function b64urlToBuf(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0));
}

function bufToB64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Register a new passkey for this user, requesting the PRF extension.
 * `userId` / `userHandle` should be your Supabase auth user id (as bytes).
 * Returns the credential id (store this) and whether PRF was granted.
 */
export async function registerPasskey({ rpId, userId, userName, displayName }) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const credential = await navigator.credentials.create({
    publicKey: {
      rp: { name: RP_NAME, id: rpId },
      user: {
        id: new TextEncoder().encode(userId),
        name: userName,
        displayName: displayName || userName,
      },
      challenge,
      pubKeyCredParams: [
        { alg: -7, type: "public-key" }, // ES256
        { alg: -257, type: "public-key" }, // RS256 fallback
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform", // fingerprint / Face ID sensor
        residentKey: "required",
        userVerification: "required",
      },
      extensions: { prf: {} },
      timeout: 60_000,
      attestation: "none",
    },
  });

  const prfSupported = !!credential.getClientExtensionResults?.().prf?.enabled;

  return {
    credentialId: bufToB64url(credential.rawId),
    prfSupported,
  };
}

/**
 * Authenticate with an existing passkey. If the authenticator supports PRF,
 * evaluates it with our fixed salt and returns the 32-byte secret — this
 * secret feeds `importWrappingKey()` in lib/crypto.js.
 */
export async function authenticatePasskey({ rpId, credentialId }) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const assertion = await navigator.credentials.get({
    publicKey: {
      rpId,
      challenge,
      allowCredentials: credentialId
        ? [{ id: b64urlToBuf(credentialId), type: "public-key" }]
        : [],
      userVerification: "required",
      extensions: { prf: { eval: { first: PRF_SALT } } },
      timeout: 60_000,
    },
  });

  const ext = assertion.getClientExtensionResults?.();
  const prfResult = ext?.prf?.results?.first; // ArrayBuffer | undefined

  return {
    credentialId: bufToB64url(assertion.rawId),
    prfSecret: prfResult ? new Uint8Array(prfResult) : null,
  };
}
