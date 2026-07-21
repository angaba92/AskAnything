"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import MessageBubble from "@/components/MessageBubble";
import CopilotPanel from "@/components/CopilotPanel";
import {
  STATUSES,
  STATUS_LABEL,
  type ThreadDetail,
  type ThreadListItem,
} from "@/lib/types";
import { ANSWER_MODES, MODE_LABELS, MODE_HINTS, type AnswerMode } from "@/lib/promptMapping";

// MIGRACIÓN: proveedores disponibles. "ka" (DY Knowledge Assistant) es el nuevo
// por defecto y recomendado; "agent" y "mcp" quedan como backup ("DO NOT USE").
type Backend = "ka" | "agent" | "mcp";

export default function Home() {
  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [filter, setFilter] = useState("All");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copilotQuestion, setCopilotQuestion] = useState<string | null>(null);
  const [mode, setMode] = useState<AnswerMode>("detailed");
  const [backend, setBackend] = useState<Backend>("ka");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    const res = await fetch("/api/threads");
    if (res.ok) setThreads(await res.json());
  }, []);

  const loadDetail = useCallback(async (id: string, sync = false) => {
    const res = await fetch(`/api/threads/${id}${sync ? "?sync=1" : ""}`);
    if (res.ok) {
      setDetail(await res.json());
    } else {
      const e = await res.json().catch(() => ({}));
      setError(e.error ?? "Error loading the thread");
    }
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    // MIGRACIÓN KA: KA/MCP guardan el historial localmente y no deben intentar
    // sincronizar el thread contra Experience OS. Solo Agent Mode usa threads DY.
    if (activeId) loadDetail(activeId, backend === "agent");
  }, [activeId, backend, loadDetail]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages.length]);

  async function handleNew() {
    setError(null);
    const res = await fetch("/api/threads/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend }),
    });
    if (res.ok) {
      const { id } = await res.json();
      await loadThreads();
      setActiveId(id);
      setDetail({ id, title: "New conversation", status: "New", tags: [], messages: [] });
    } else {
      const e = await res.json().catch(() => ({}));
      setError(e.error ?? "Could not create the thread");
    }
  }

  async function handleSend() {
    if (!input.trim() || !activeId || sending) return;
    setError(null);
    setSending(true);
    const text = input;
    setInput("");
    setCopilotQuestion(text);

    // Optimista: pintamos el mensaje humano.
    setDetail((d) =>
      d
        ? {
            ...d,
            messages: [
              ...d.messages,
              {
                id: `tmp-${Date.now()}`,
                role: "human",
                text,
                seqId: (d.messages.at(-1)?.seqId ?? 0) + 1,
                createdAt: new Date().toISOString(),
              },
            ],
          }
        : d
    );

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: activeId, message: text, mode, backend }),
    });

    if (res.ok) {
      await loadDetail(activeId);
      await loadThreads();
    } else {
      const e = await res.json().catch(() => ({}));
      setError(e.error ?? "Error sending the message");
    }
    setSending(false);
  }

  async function patchThread(data: Partial<{ status: string; tags: string[]; title: string }>) {
    if (!activeId) return;
    await fetch("/api/threads", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: activeId, ...data }),
    });
    await loadThreads();
    setDetail((d) => (d ? { ...d, ...data } as ThreadDetail : d));
  }

  function startEditTitle() {
    if (!detail) return;
    setTitleDraft(detail.title);
    setEditingTitle(true);
  }

  async function saveTitle() {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (next && next !== detail?.title) await patchThread({ title: next });
  }

  return (
    <div className="flex h-screen">
      <Sidebar
        threads={threads}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={handleNew}
        filter={filter}
        onFilter={setFilter}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div className="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            <span>{error}</span>
            {backend === "agent" &&
              /caduc|sesión|session|cookie|XSRF/i.test(error) && (
              <a
                href="/settings"
                className="shrink-0 rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
              >
                Refresh session →
              </a>
            )}
          </div>
        )}

        {!detail ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-2xl">
              💬
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-800">
                DY Knowledge Assistant
              </h2>
              <p className="mt-1 max-w-md text-sm text-gray-400">
                Ask anything about Dynamic Yield. Create or select a conversation
                on the left to start — answers are grounded in DY documentation
                and approved knowledge.
              </p>
            </div>
            <button
              onClick={handleNew}
              className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
            >
              + New conversation
            </button>
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-3">
              {editingTitle ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveTitle();
                    } else if (e.key === "Escape") {
                      setEditingTitle(false);
                    }
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-brand px-2 py-1 font-medium focus:outline-none"
                />
              ) : (
                <button
                  onClick={startEditTitle}
                  title="Click to rename"
                  className="group flex min-w-0 items-center gap-2 text-left"
                >
                  <h2 className="truncate font-medium">{detail.title}</h2>
                  <span className="shrink-0 text-gray-300 opacity-0 transition group-hover:opacity-100">
                    ✎
                  </span>
                </button>
              )}
              <div className="flex shrink-0 items-center gap-3">
                <select
                  value={detail.status}
                  onChange={(e) => patchThread({ status: e.target.value })}
                  className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
                {backend === "agent" && (
                  <button
                    onClick={() => loadDetail(detail.id, true)}
                    className="rounded-lg border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
                  >
                    Sync
                  </button>
                )}
              </div>
            </header>

            <div className="flex-1 overflow-y-auto bg-gray-50 px-6 py-4">
              {detail.messages.length === 0 && (
                <p className="text-center text-sm text-gray-400">
                  Type your question below to start.
                </p>
              )}
              {detail.messages.map((m) => (
                <MessageBubble key={m.id} m={m} />
              ))}
              {sending && (
                <p className="text-center text-xs text-gray-400">
                  The agent is replying…
                </p>
              )}
              <div ref={bottomRef} />
            </div>

            <footer className="border-t border-gray-200 bg-white p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-400">Answer style:</span>
                {/* Estilos mapeados desde la configuración central (promptMapping). */}
                <div className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-xs">
                  {ANSWER_MODES.map((m, i) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={`${i > 0 ? "border-l border-gray-300 " : ""}px-2.5 py-1 ${
                        mode === m
                          ? "bg-brand text-white"
                          : "bg-white text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {MODE_LABELS[m]}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-gray-400">{MODE_HINTS[mode]}</span>
                <span className="mx-1 h-4 w-px bg-gray-200" />
                <span className="text-xs text-gray-400">Backend:</span>
                {/* MIGRACIÓN: KA es el nuevo por defecto (recomendado). Agent y MCP
                    se mantienen disponibles pero marcados "DO NOT USE" (backup). */}
                <div className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-xs">
                  <button
                    type="button"
                    onClick={() => setBackend("ka")}
                    className={`px-2.5 py-1 ${
                      backend === "ka" ? "bg-brand text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    Knowledge Assistant
                  </button>
                  <button
                    type="button"
                    onClick={() => setBackend("agent")}
                    title="Deprecated — backup only. Do not use."
                    className={`border-l border-gray-300 px-2.5 py-1 ${
                      backend === "agent"
                        ? "bg-red-600 text-white"
                        : "bg-white text-gray-400 line-through hover:bg-gray-50"
                    }`}
                  >
                    Agent · DO NOT USE
                  </button>
                  <button
                    type="button"
                    onClick={() => setBackend("mcp")}
                    title="Deprecated — backup only. Do not use."
                    className={`border-l border-gray-300 px-2.5 py-1 ${
                      backend === "mcp"
                        ? "bg-red-600 text-white"
                        : "bg-white text-gray-400 line-through hover:bg-gray-50"
                    }`}
                  >
                    MCP · DO NOT USE
                  </button>
                </div>
                <span className="text-[11px] text-gray-400">
                  {backend === "ka"
                    ? "DY Knowledge Assistant — grounded, cited answers (recommended)"
                    : backend === "mcp"
                    ? "Backup only · corporate network — run locally"
                    : "Backup only · Experience OS agent (threaded)"}
                </span>
              </div>
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Ask anything…"
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !input.trim()}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </footer>
          </>
        )}
      </main>

      <CopilotPanel question={copilotQuestion} />
    </div>
  );
}
