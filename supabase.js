/**
 * lib/supabase.js
 * ---------------------------------------------------------------------------
 * Thin Supabase client + data-access helpers.
 *
 * IMPORTANT: every function in this file only ever sees/sends ciphertext,
 * base64 IVs, and non-secret metadata. If you find yourself tempted to pass
 * a CryptoKey or plaintext string into one of these functions, stop — encrypt
 * first in the calling component using lib/crypto.js.
 * ---------------------------------------------------------------------------
 */
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// ---- Account / key material (non-secret) -----------------------------------

export async function getUserVaultMeta(userId) {
  const { data, error } = await supabase
    .from("vault_meta")
    .select("salt, pbkdf2_iterations, wrapped_key_iv, wrapped_key")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  return data;
}

export async function upsertVaultMeta(userId, meta) {
  const { error } = await supabase.from("vault_meta").upsert({
    user_id: userId,
    ...meta,
  });
  if (error) throw error;
}

// ---- Secure Notes ------------------------------------------------------------

export async function listNotes(userId) {
  const { data, error } = await supabase
    .from("vault_notes")
    .select("id, iv, ciphertext, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function saveNote(userId, { id, iv, ciphertext }) {
  const { data, error } = await supabase
    .from("vault_notes")
    .upsert({ id, user_id: userId, iv, ciphertext, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteNote(userId, id) {
  const { error } = await supabase
    .from("vault_notes")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw error;
}

// ---- Password Manager entries -----------------------------------------------

export async function listPasswordEntries(userId) {
  const { data, error } = await supabase
    .from("vault_passwords")
    .select("id, iv, ciphertext, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function savePasswordEntry(userId, { id, iv, ciphertext }) {
  const { data, error } = await supabase
    .from("vault_passwords")
    .upsert({ id, user_id: userId, iv, ciphertext, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletePasswordEntry(userId, id) {
  const { error } = await supabase
    .from("vault_passwords")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw error;
}

// ---- File Vault (Supabase Storage) ------------------------------------------

const FILES_BUCKET = "vault-files";

export async function uploadEncryptedFile(userId, fileId, encryptedBlob) {
  const path = `${userId}/${fileId}`;
  const { error } = await supabase.storage
    .from(FILES_BUCKET)
    .upload(path, encryptedBlob, { upsert: true, contentType: "application/octet-stream" });
  if (error) throw error;
  return path;
}

export async function downloadEncryptedFile(userId, fileId) {
  const path = `${userId}/${fileId}`;
  const { data, error } = await supabase.storage.from(FILES_BUCKET).download(path);
  if (error) throw error;
  return data; // Blob
}

export async function deleteEncryptedFile(userId, fileId) {
  const path = `${userId}/${fileId}`;
  const { error } = await supabase.storage.from(FILES_BUCKET).remove([path]);
  if (error) throw error;
}

export async function listFileRecords(userId) {
  // File *metadata* (name, size, mime) is itself sensitive, so it's stored
  // encrypted too, in a normal table — only the storage blob path/id is
  // in the clear (a random UUID, meaningless on its own).
  const { data, error } = await supabase
    .from("vault_files")
    .select("id, iv, ciphertext, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function saveFileRecord(userId, { id, iv, ciphertext }) {
  const { data, error } = await supabase
    .from("vault_files")
    .upsert({ id, user_id: userId, iv, ciphertext, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteFileRecord(userId, id) {
  const { error } = await supabase
    .from("vault_files")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw error;
}
