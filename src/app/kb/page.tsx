"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

interface KbDoc {
  id: string;
  name: string;
  kind: string;
  chunks: number;
  createdAt: string;
}
interface Source {
  n: number;
  source: string;
  kind: string;
  question: string | null;
  score: number;
  preview: string;
}

export default function KbPage() {
  const [configured, setConfigured] = useState(true);
  const [aiWriter, setAiWriter] = useState(false);
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [totalChunks, setTotalChunks] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [question, setQuestion] = useState("");
  const [context, setContext] = useState("");
  const [answer, setAnswer] = useState("");
  const [mode, setMode] = useState<string>("");
  const [sources, setSources] = useState<Source[]>([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/kb/status");
    if (res.ok) {
      const d = await res.json();
      setConfigured(d.configured);
      setAiWriter(d.aiWriter);
      setDocs(d.docs);
      setTotalChunks(d.totalChunks);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    try {
      const res = await fetch("/api/kb/ingest", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      await loadStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(id: string) {
    await fetch(`/api/kb/status?id=${id}`, { method: "DELETE" });
    await loadStatus();
  }

  async function ask() {
    if (!question.trim() || asking) return;
    setAsking(true);
    setError(null);
    setAnswer("");
    setSources([]);
    try {
      const res = await fetch("/api/kb/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, context }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      setAnswer(data.answer);
      setMode(data.mode ?? "");
      setSources(data.sources ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-brand-dark">
          Knowledge base (RFP assistant)
        </h1>
        <Link href="/" className="text-sm text-brand hover:underline">
          ← Back to chat
        </Link>
      </div>

      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-500">
        Mode:{" "}
        {aiWriter ? (
          <span className="font-medium text-green-600">
            AI writer (GitHub Models) — drafts answers with citations
          </span>
        ) : (
          <span className="font-medium text-brand">
            Local match (BM25) — returns the closest past answers, no AI / no setup
          </span>
        )}
        . Works fully offline; add <code>GITHUB_MODELS_TOKEN</code> later to enable
        AI drafting.
      </div>
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-[1fr_320px]">
        {/* Columna izquierda: preguntar */}
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <label className="mb-1 block text-sm font-medium">
              Company / deal context (optional)
            </label>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={2}
              placeholder="e.g. Answering an RFP for a mid-market retail bank in the EU."
              className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
            <label className="mb-1 block text-sm font-medium">Question</label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
              }}
              rows={3}
              placeholder="Paste an RFP question…  (⌘/Ctrl + Enter to ask)"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
            <button
              onClick={ask}
              disabled={asking || !question.trim() || totalChunks === 0}
              className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {asking ? "Searching & writing…" : "Answer from knowledge base"}
            </button>
            {totalChunks === 0 && (
              <p className="mt-2 text-xs text-gray-400">
                Upload documents first (right panel).
              </p>
            )}
          </div>

          {answer && (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand-dark">
                Answer
                {mode === "ai" && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                    AI-written
                  </span>
                )}
                {mode === "match" && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                    Closest match
                  </span>
                )}
                {mode === "nomatch" && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    No match
                  </span>
                )}
              </h3>
              <div className="prose prose-sm max-w-none text-sm text-gray-800">
                <ReactMarkdown>{answer}</ReactMarkdown>
              </div>
              {sources.length > 0 && (
                <div className="mt-4 border-t border-gray-100 pt-3">
                  <p className="mb-2 text-xs font-semibold uppercase text-gray-400">
                    Sources
                  </p>
                  <ul className="space-y-2">
                    {sources.map((s) => (
                      <li key={s.n} className="text-xs text-gray-600">
                        <span className="font-mono text-gray-400">[{s.n}]</span>{" "}
                        <span className="font-medium">{s.source}</span>{" "}
                        <span className="text-gray-400">
                          · {s.kind} · score {s.score}
                        </span>
                        {s.question && (
                          <span className="text-gray-500"> · “{s.question}”</span>
                        )}
                        <p className="mt-0.5 text-gray-400">{s.preview}…</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Columna derecha: documentos */}
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="mb-3 text-sm font-semibold text-brand-dark">
              Documents ({totalChunks} chunks)
            </h3>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".xlsx,.xls,.pdf,.docx"
              onChange={upload}
              disabled={uploading || !configured}
              className="w-full text-xs"
            />
            <p className="mt-1 text-[11px] text-gray-400">
              .xlsx (Q&amp;A bank), .pdf, .docx
            </p>
            {uploading && (
              <p className="mt-2 text-xs text-amber-600">
                Parsing &amp; embedding… (can take a while for big files)
              </p>
            )}

            <ul className="mt-3 space-y-1">
              {docs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-2 py-1 text-xs"
                >
                  <span className="truncate" title={d.name}>
                    {d.name}
                  </span>
                  <span className="shrink-0 text-gray-400">{d.chunks}</span>
                  <button
                    onClick={() => remove(d.id)}
                    className="shrink-0 text-red-400 hover:text-red-600"
                    title="Remove"
                  >
                    ✕
                  </button>
                </li>
              ))}
              {docs.length === 0 && (
                <li className="text-xs text-gray-400">No documents yet.</li>
              )}
            </ul>
            {docs.length > 0 && (
              <button
                onClick={() => remove("all")}
                className="mt-3 text-[11px] text-gray-400 hover:text-red-600"
              >
                Clear all
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
