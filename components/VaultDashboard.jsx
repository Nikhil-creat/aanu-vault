"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  StickyNote,
  KeyRound,
  FolderLock,
  Plus,
  Trash2,
  Copy,
  Eye,
  EyeOff,
  UploadCloud,
  Download,
  File as FileIcon,
} from "lucide-react";
import AutoLockDial from "./AutoLockDial";
import {
  encrypt,
  decryptToString,
  encryptFile,
  decryptFile,
} from "../lib/crypto";
import * as db from "../lib/supabase";

const AUTO_LOCK_SECONDS = 180; // 3 minutes, per spec
const TABS = [
  { id: "notes", label: "Secure Notes", icon: StickyNote },
  { id: "passwords", label: "Password Manager", icon: KeyRound },
  { id: "files", label: "File Vault", icon: FolderLock },
];

/**
 * VaultDashboard
 * ---------------------------------------------------------------------------
 * Receives an already-derived, in-memory `masterKey` (CryptoKey) from the
 * parent unlock flow (see app/page.jsx). This component never sees the
 * master password and never persists the key anywhere — it lives only in
 * this component tree's React state, for the lifetime of the unlocked
 * session, and is wiped by calling `onLock()` on inactivity or tab close.
 * ---------------------------------------------------------------------------
 */
export default function VaultDashboard({ userId, masterKey, onLock }) {
  const [tab, setTab] = useState("notes");
  const [notes, setNotes] = useState([]);
  const [passwords, setPasswords] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [secondsRemaining, setSecondsRemaining] = useState(AUTO_LOCK_SECONDS);

  // ---- Auto-lock: reset the countdown on any real user interaction --------
  const lastActivity = useRef(Date.now());

  const bumpActivity = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  useEffect(() => {
    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, bumpActivity, { passive: true }));

    const tick = setInterval(() => {
      const idleSeconds = Math.floor((Date.now() - lastActivity.current) / 1000);
      const remaining = AUTO_LOCK_SECONDS - idleSeconds;
      setSecondsRemaining(Math.max(0, remaining));
      if (remaining <= 0) {
        clearInterval(tick);
        onLock(); // parent wipes masterKey from memory and shows the lock screen
      }
    }, 1000);

    return () => {
      events.forEach((e) => window.removeEventListener(e, bumpActivity));
      clearInterval(tick);
    };
  }, [bumpActivity, onLock]);

  // ---- Load + decrypt everything once, on unlock ---------------------------
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [rawNotes, rawPw, rawFiles] = await Promise.all([
        db.listNotes(userId),
        db.listPasswordEntries(userId),
        db.listFileRecords(userId),
      ]);

      const decryptAll = (rows) =>
        Promise.all(
          rows.map(async (row) => {
            try {
              const json = await decryptToString(masterKey, row);
              return { id: row.id, updated_at: row.updated_at, ...JSON.parse(json) };
            } catch {
              return { id: row.id, updated_at: row.updated_at, error: true };
            }
          })
        );

      setNotes(await decryptAll(rawNotes));
      setPasswords(await decryptAll(rawPw));
      setFiles(await decryptAll(rawFiles));
      setLoading(false);
    })();
  }, [userId, masterKey]);

  // ---- Notes ----------------------------------------------------------------
  const upsertNote = async (note) => {
    const { iv, ciphertext } = await encrypt(
      masterKey,
      JSON.stringify({ title: note.title, body: note.body })
    );
    const saved = await db.saveNote(userId, { id: note.id, iv, ciphertext });
    setNotes((prev) => {
      const others = prev.filter((n) => n.id !== saved.id);
      return [{ ...note, id: saved.id, updated_at: saved.updated_at }, ...others];
    });
  };

  const removeNote = async (id) => {
    await db.deleteNote(userId, id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
  };

  // ---- Passwords --------------------------------------------------------------
  const upsertPasswordEntry = async (entry) => {
    const { iv, ciphertext } = await encrypt(
      masterKey,
      JSON.stringify({
        site: entry.site,
        username: entry.username,
        password: entry.password,
      })
    );
    const saved = await db.savePasswordEntry(userId, { id: entry.id, iv, ciphertext });
    setPasswords((prev) => {
      const others = prev.filter((p) => p.id !== saved.id);
      return [{ ...entry, id: saved.id, updated_at: saved.updated_at }, ...others];
    });
  };

  const removePasswordEntry = async (id) => {
    await db.deletePasswordEntry(userId, id);
    setPasswords((prev) => prev.filter((p) => p.id !== id));
  };

  // ---- Files ------------------------------------------------------------------
  const [uploadProgress, setUploadProgress] = useState({}); // { [tempId]: pct }

  const handleFiles = async (fileList) => {
    for (const file of Array.from(fileList)) {
      const tempId = crypto.randomUUID();
      setUploadProgress((p) => ({ ...p, [tempId]: 0 }));

      const encryptedBlob = await encryptFile(masterKey, file, (pct) =>
        setUploadProgress((p) => ({ ...p, [tempId]: pct }))
      );

      const { iv, ciphertext } = await encrypt(
        masterKey,
        JSON.stringify({ name: file.name, size: file.size, mime: file.type })
      );
      const record = await db.saveFileRecord(userId, { id: tempId, iv, ciphertext });
      await db.uploadEncryptedFile(userId, record.id, encryptedBlob);

      setFiles((prev) => [
        { id: record.id, name: file.name, size: file.size, mime: file.type, updated_at: record.updated_at },
        ...prev,
      ]);
      setUploadProgress((p) => {
        const { [tempId]: _drop, ...rest } = p;
        return rest;
      });
    }
  };

  const downloadAndDecryptFile = async (fileRecord) => {
    const blob = await db.downloadEncryptedFile(userId, fileRecord.id);
    const plainBlob = await decryptFile(masterKey, blob);
    const url = URL.createObjectURL(new Blob([plainBlob], { type: fileRecord.mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileRecord.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const removeFile = async (id) => {
    await db.deleteFileRecord(userId, id);
    await db.deleteEncryptedFile(userId, id);
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-neutral-200">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-white p-1 flex items-center justify-center overflow-hidden">
            <img src="/aanu-icon.png" alt="" className="h-full w-full object-contain" />
          </div>
          <span className="font-semibold tracking-tight">AANU</span>
          <span className="text-xs text-neutral-600">Ultimate Vault</span>
        </div>
        <div className="flex items-center gap-4">
          <AutoLockDial secondsRemaining={secondsRemaining} totalSeconds={AUTO_LOCK_SECONDS} />
          <button
            onClick={onLock}
            className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            Lock now
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-4">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-t-lg px-4 py-2 text-sm transition-colors ${
              tab === id
                ? "bg-[#101826] text-neutral-100"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      <div className="bg-[#101826] min-h-[calc(100vh-116px)] px-6 py-6 rounded-tr-lg">
        {loading ? (
          <div className="text-neutral-500 text-sm">Decrypting your vault…</div>
        ) : (
          <AnimatePresence mode="wait">
            {tab === "notes" && (
              <NotesPanel key="notes" notes={notes} onSave={upsertNote} onDelete={removeNote} />
            )}
            {tab === "passwords" && (
              <PasswordsPanel
                key="passwords"
                entries={passwords}
                onSave={upsertPasswordEntry}
                onDelete={removePasswordEntry}
              />
            )}
            {tab === "files" && (
              <FilesPanel
                key="files"
                files={files}
                uploadProgress={uploadProgress}
                onDrop={handleFiles}
                onDownload={downloadAndDecryptFile}
                onDelete={removeFile}
              />
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Secure Notes panel
// ---------------------------------------------------------------------------
function NotesPanel({ notes, onSave, onDelete }) {
  const [draft, setDraft] = useState({ title: "", body: "" });

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <div className="mb-6 rounded-xl border border-white/5 bg-[#0a0f1a] p-4">
        <input
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          placeholder="Note title"
          className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-neutral-600 mb-2"
        />
        <textarea
          value={draft.body}
          onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          placeholder="Write something only you can read…"
          rows={3}
          className="w-full bg-transparent text-sm outline-none placeholder:text-neutral-600 resize-none"
        />
        <button
          onClick={async () => {
            if (!draft.title && !draft.body) return;
            await onSave({ id: crypto.randomUUID(), ...draft });
            setDraft({ title: "", body: "" });
          }}
          className="mt-2 flex items-center gap-1 rounded-lg bg-[#22d3ee] px-3 py-1.5 text-xs font-medium text-black hover:bg-[#67e8f9] transition-colors"
        >
          <Plus size={13} /> Save note
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {notes.map((n) => (
          <div key={n.id} className="rounded-xl border border-white/5 bg-[#0a0f1a] p-4">
            <div className="mb-1 flex items-start justify-between">
              <h4 className="text-sm font-medium">{n.title || "Untitled"}</h4>
              <button onClick={() => onDelete(n.id)} className="text-neutral-600 hover:text-[#c96e4e]">
                <Trash2 size={14} />
              </button>
            </div>
            <p className="text-xs text-neutral-500 whitespace-pre-wrap">{n.body}</p>
          </div>
        ))}
        {notes.length === 0 && <EmptyState label="No notes yet. Anything you write here is sealed before it leaves your device." />}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Password Manager panel
// ---------------------------------------------------------------------------
function PasswordsPanel({ entries, onSave, onDelete }) {
  const [draft, setDraft] = useState({ site: "", username: "", password: "" });
  const [revealed, setRevealed] = useState({});

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <div className="mb-6 grid gap-2 rounded-xl border border-white/5 bg-[#0a0f1a] p-4 sm:grid-cols-4">
        <input
          value={draft.site}
          onChange={(e) => setDraft((d) => ({ ...d, site: e.target.value }))}
          placeholder="Site / app"
          className="rounded-lg bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-neutral-600"
        />
        <input
          value={draft.username}
          onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))}
          placeholder="Username or email"
          className="rounded-lg bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-neutral-600"
        />
        <input
          type="password"
          value={draft.password}
          onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
          placeholder="Password"
          className="rounded-lg bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-neutral-600"
        />
        <button
          onClick={async () => {
            if (!draft.site) return;
            await onSave({ id: crypto.randomUUID(), ...draft });
            setDraft({ site: "", username: "", password: "" });
          }}
          className="flex items-center justify-center gap-1 rounded-lg bg-[#22d3ee] px-3 py-2 text-xs font-medium text-black hover:bg-[#67e8f9] transition-colors"
        >
          <Plus size={13} /> Add
        </button>
      </div>

      <div className="space-y-2">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center justify-between rounded-xl border border-white/5 bg-[#0a0f1a] px-4 py-3"
          >
            <div>
              <div className="text-sm font-medium">{entry.site}</div>
              <div className="text-xs text-neutral-500">{entry.username}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-neutral-400">
                {revealed[entry.id] ? entry.password : "•".repeat(10)}
              </span>
              <button
                onClick={() => setRevealed((r) => ({ ...r, [entry.id]: !r[entry.id] }))}
                className="text-neutral-500 hover:text-neutral-300"
              >
                {revealed[entry.id] ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                onClick={() => navigator.clipboard.writeText(entry.password)}
                className="text-neutral-500 hover:text-neutral-300"
              >
                <Copy size={14} />
              </button>
              <button onClick={() => onDelete(entry.id)} className="text-neutral-600 hover:text-[#c96e4e]">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {entries.length === 0 && <EmptyState label="No saved credentials yet." />}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// File Vault panel — drag & drop, client-side encrypted before upload
// ---------------------------------------------------------------------------
function FilesPanel({ files, uploadProgress, onDrop, onDownload, onDelete }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onDrop(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`mb-6 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 transition-colors ${
          dragging ? "border-[#22d3ee] bg-[#22d3ee]/5" : "border-white/10 hover:border-white/20"
        }`}
      >
        <UploadCloud size={22} className="text-neutral-500" />
        <p className="text-sm text-neutral-400">Drag files here, or click to choose</p>
        <p className="text-xs text-neutral-600">Encrypted on your device before upload — always.</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => e.target.files?.length && onDrop(e.target.files)}
        />
      </div>

      {Object.entries(uploadProgress).map(([id, pct]) => (
        <div key={id} className="mb-2 rounded-lg bg-white/5 p-3">
          <div className="mb-1 flex justify-between text-xs text-neutral-400">
            <span>Encrypting & uploading…</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full bg-[#22d3ee]"
              animate={{ width: `${pct}%` }}
              transition={{ ease: "easeOut", duration: 0.2 }}
            />
          </div>
        </div>
      ))}

      <div className="space-y-2">
        {files.map((f) => (
          <div
            key={f.id}
            className="flex items-center justify-between rounded-xl border border-white/5 bg-[#0a0f1a] px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <FileIcon size={16} className="text-neutral-500" />
              <div>
                <div className="text-sm font-medium">{f.name || "(undecryptable)"}</div>
                <div className="text-xs text-neutral-500">
                  {f.size ? `${(f.size / 1024).toFixed(1)} KB` : ""}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => onDownload(f)} className="text-neutral-500 hover:text-neutral-300">
                <Download size={15} />
              </button>
              <button onClick={() => onDelete(f.id)} className="text-neutral-600 hover:text-[#c96e4e]">
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
        {files.length === 0 && <EmptyState label="No files yet. Drop something above." />}
      </div>
    </motion.div>
  );
}

function EmptyState({ label }) {
  return <p className="text-sm text-neutral-600 py-6 text-center">{label}</p>;
}
