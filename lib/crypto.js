/**
 * lib/crypto.js
 * ---------------------------------------------------------------------------
 * AANU — Zero-Knowledge Cryptography Engine
 * ---------------------------------------------------------------------------
 * Everything in this file runs ONLY in the browser. Nothing here ever
 * transmits a raw key, a derived key, or plaintext to a network call.
 *
 * Threat model / what this buys you:
 *   - Supabase (DB + storage) only ever sees ciphertext + non-secret params
 *     (salt, iv, PBKDF2 iteration count, wrapped-key blob).
 *   - A compromised or curious server admin cannot read vault contents.
 *   - This does NOT protect against a compromised end-user device/browser,
 *     a malicious browser extension, a keylogger, or the user being
 *     phished for their master password. "Zero-knowledge server" is a
 *     real, meaningful property — "hack-proof" in an absolute sense is not
 *     a claim any honest engineer makes. Document this for your users.
 *
 * Primitives used:
 *   - PBKDF2-SHA256, 600,000 iterations  -> Master Key (AES-256-GCM)
 *   - HKDF-SHA256                        -> derives a Wrapping Key from the
 *                                            WebAuthn PRF secret
 *   - AES-256-GCM                        -> all data encryption + key wrapping
 * ---------------------------------------------------------------------------
 */

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12; // 96-bit IV, standard + required for AES-GCM

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function randomBytes(len) {
  return crypto.getRandomValues(new Uint8Array(len));
}

export function toB64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

export function fromB64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function concatBytes(...arrs) {
  const total = arrs.reduce((n, a) => n + a.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrs) {
    out.set(new Uint8Array(a), offset);
    offset += a.byteLength;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Master Key derivation (Master Password -> AES-256-GCM CryptoKey)
// ---------------------------------------------------------------------------

/**
 * Derive the Master Key from the user's password + a per-user salt.
 * The salt is NOT secret — it's stored server-side alongside the account
 * (it just needs to be unique per user so precomputed rainbow tables don't
 * work across accounts). Security comes from the password + iteration count.
 */
export async function deriveMasterKey(password, saltBytes, { extractable = false } = {}) {
  const passKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    passKey,
    { name: "AES-GCM", length: 256 },
    extractable, // false in normal operation: key never leaves the CryptoKey sandbox
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
  );
}

export function generateSalt() {
  return randomBytes(SALT_BYTES);
}

export const PBKDF2_ITERATIONS_USED = PBKDF2_ITERATIONS;

// ---------------------------------------------------------------------------
// Generic AES-256-GCM encrypt / decrypt (used for notes, password entries,
// and file contents — anything that becomes ciphertext bound for Supabase)
// ---------------------------------------------------------------------------

/**
 * @param {CryptoKey} key   AES-GCM CryptoKey
 * @param {ArrayBuffer|Uint8Array|string} data
 * @returns {{ iv: string, ciphertext: string }} base64-encoded, safe to store/transmit
 */
export async function encrypt(key, data) {
  const iv = randomBytes(IV_BYTES);
  const plainBytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;

  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plainBytes
  );

  return {
    iv: toB64(iv),
    ciphertext: toB64(cipherBuf),
  };
}

/**
 * @returns {ArrayBuffer} decrypted raw bytes — caller decides text vs binary
 */
export async function decrypt(key, { iv, ciphertext }) {
  const ivBytes = fromB64(iv);
  const cipherBytes = fromB64(ciphertext);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, key, cipherBytes);
}

export async function decryptToString(key, payload) {
  const buf = await decrypt(key, payload);
  return new TextDecoder().decode(buf);
}

// ---------------------------------------------------------------------------
// File encryption — chunked so large files don't need to live fully in
// memory twice. Each chunk is its own AES-GCM frame: [4-byte length][iv][ct]
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB plaintext per chunk

export async function encryptFile(key, file, onProgress) {
  const chunks = [];
  const total = file.size;
  let processed = 0;

  for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const buf = await slice.arrayBuffer();
    const iv = randomBytes(IV_BYTES);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, buf);

    const frame = concatBytes(iv, new Uint8Array(ct));
    const lenPrefix = new Uint8Array(4);
    new DataView(lenPrefix.buffer).setUint32(0, frame.byteLength, false);

    chunks.push(concatBytes(lenPrefix, frame));
    processed += buf.byteLength;
    onProgress?.(Math.min(100, Math.round((processed / total) * 100)));
  }

  return new Blob(chunks, { type: "application/octet-stream" });
}

export async function decryptFile(key, encryptedBlob, onProgress) {
  const buf = new Uint8Array(await encryptedBlob.arrayBuffer());
  const parts = [];
  let cursor = 0;
  const total = buf.byteLength;

  while (cursor < total) {
    const len = new DataView(buf.buffer, buf.byteOffset + cursor, 4).getUint32(0, false);
    cursor += 4;
    const frame = buf.slice(cursor, cursor + len);
    cursor += len;

    const iv = frame.slice(0, IV_BYTES);
    const ct = frame.slice(IV_BYTES);
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    parts.push(plainBuf);
    onProgress?.(Math.min(100, Math.round((cursor / total) * 100)));
  }

  return new Blob(parts);
}

// ---------------------------------------------------------------------------
// Key wrapping — used to seal the Master Key behind a WebAuthn PRF secret so
// unlocking with just a fingerprint doesn't require retyping the password.
// See lib/webauthn.js for how the wrapping key is produced.
// ---------------------------------------------------------------------------

export async function importWrappingKey(rawSecretBytes) {
  // The PRF output (or HKDF-expanded form of it) becomes an AES-KW-capable key
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    rawSecretBytes,
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(16), // fixed, non-secret domain-separation salt
      info: new TextEncoder().encode("aanu-key-wrap-v1"),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Wrap (encrypt) an *extractable* Master Key with the wrapping key derived
 * from the passkey's PRF secret, so it can be safely stored (e.g. in
 * Supabase or IndexedDB) and only unwrapped after a successful biometric
 * assertion.
 */
export async function wrapMasterKey(extractableMasterKey, wrappingKey) {
  const iv = randomBytes(IV_BYTES);
  const raw = await crypto.subtle.exportKey("raw", extractableMasterKey);
  const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, raw);
  return { iv: toB64(iv), wrapped: toB64(wrapped) };
}

export async function unwrapMasterKey({ iv, wrapped }, wrappingKey) {
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(iv) },
    wrappingKey,
    fromB64(wrapped)
  );
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}
