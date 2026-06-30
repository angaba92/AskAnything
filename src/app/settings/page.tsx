"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface SessionStatus {
  source: "db" | "file" | "env" | "none";
  hasCookie: boolean;
  hasXsrf: boolean;
  sectionId: string;
  masked: string;
  updatedAt: string | null;
}

export default function SettingsPage() {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [input, setInput] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(
    null
  );

  const load = useCallback(async () => {
    const res = await fetch("/api/dy-session");
    if (res.ok) {
      const s: SessionStatus = await res.json();
      setStatus(s);
      if (s.sectionId) setSectionId(s.sectionId);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!input.trim() || saving) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/dy-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input, sectionId: sectionId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error ?? "Error" });
      } else if (data.valid === false) {
        setMsg({
          kind: "warn",
          text: `Saved, but DY rejected it on test: ${data.message ?? ""}. Make sure you copied the cookie right after logging in.`,
        });
      } else {
        setMsg({ kind: "ok", text: "Session updated and validated against DY. The team can use it now." });
        setInput("");
      }
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const badge =
    status?.source === "db" || status?.source === "file"
      ? { text: "Shared session active", cls: "bg-green-100 text-green-700" }
      : status?.source === "env"
      ? { text: "Using .env.local", cls: "bg-blue-100 text-blue-700" }
      : { text: "No session", cls: "bg-amber-100 text-amber-700" };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-brand-dark">Settings · Dynamic Yield session</h1>
        <Link href="/" className="text-sm text-brand hover:underline">
          ← Back to chat
        </Link>
      </div>

      <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-2 flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>
            {badge.text}
          </span>
          {status?.hasCookie && !status.hasXsrf && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
              Missing XSRF-TOKEN
            </span>
          )}
        </div>
        <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-sm text-gray-600">
          <dt className="text-gray-400">Cookie</dt>
          <dd className="font-mono text-xs">{status?.masked || "—"}</dd>
          <dt className="text-gray-400">Section ID</dt>
          <dd>{status?.sectionId || "—"}</dd>
          <dt className="text-gray-400">Updated</dt>
          <dd>{status?.updatedAt ? new Date(status.updatedAt).toLocaleString() : "—"}</dd>
        </dl>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-brand-dark">Refresh the session</h2>
        <p className="mb-3 text-xs text-gray-500">
          When you see &ldquo;Session expired&rdquo;: in DY (logged in) open DevTools →
          Network → right-click a <code>/agents/chats/...</code> request →
          <strong> Copy → Copy as cURL</strong>, and paste it here. I extract the
          cookie automatically. You can also paste just the <code>cookie</code> header.
          This updates the session <strong>for the whole team</strong> without a restart.
        </p>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="curl 'https://adm.dynamicyield.com/agents/chats/...'  —or—  _mkto_trk=...; XSRF-TOKEN=...; ..."
          className="h-40 w-full resize-y rounded-lg border border-gray-300 p-3 font-mono text-xs focus:border-brand focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-3">
          <input
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            placeholder="Section ID (optional)"
            className="w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
          <button
            onClick={save}
            disabled={saving || !input.trim()}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save and test"}
          </button>
        </div>
        {msg && (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-xs ${
              msg.kind === "ok"
                ? "bg-green-50 text-green-700"
                : msg.kind === "warn"
                ? "bg-amber-50 text-amber-800"
                : "bg-red-50 text-red-700"
            }`}
          >
            {msg.text}
          </p>
        )}
      </div>

      <p className="mt-4 text-xs text-gray-400">
        The cookie is stored on the server (in the database) and is never exposed
        to the browser. It is the owner&apos;s personal SSO session; do not share
        it outside the team.
      </p>
    </div>
  );
}
