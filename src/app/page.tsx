"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import MessageBubble from "@/components/MessageBubble";
import {
  STATUSES,
  STATUS_LABEL,
  type ThreadDetail,
  type ThreadListItem,
} from "@/lib/types";
import {
  ANSWER_MODES,
  MAX_CUSTOM_PROMPT_CHARS,
  MODE_LABELS,
  MODE_HINTS,
  type AnswerMode,
} from "@/lib/promptMapping";
import {
  askKaViaExtension,
  isExtensionBridgeAvailable,
} from "@/lib/extensionBridge";

export default function Home() {
  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [filter, setFilter] = useState("All");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<AnswerMode>("detailed");
  const [customPrompt, setCustomPrompt] = useState("");
  const [customPromptFileName, setCustomPromptFileName] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [bridgeRequired, setBridgeRequired] = useState(false);
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
    const required = !["localhost", "127.0.0.1"].includes(
      window.location.hostname,
    );
    setBridgeRequired(required);
    if (!required) {
      setBridgeConnected(false);
      return;
    }

    let active = true;
    const check = () => {
      isExtensionBridgeAvailable().then((connected) => {
        if (active) setBridgeConnected(connected);
      });
    };
    check();
    window.addEventListener("focus", check);
    return () => {
      active = false;
      window.removeEventListener("focus", check);
    };
  }, []);

  useEffect(() => {
    if (activeId) loadDetail(activeId);
  }, [activeId, loadDetail]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages.length]);

  async function handleNew() {
    setError(null);
    const res = await fetch("/api/threads/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
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

    let localKaResponse: string | undefined;
    if (bridgeRequired) {
      const connected =
        bridgeConnected || (await isExtensionBridgeAvailable());
      setBridgeConnected(connected);
      if (!connected) {
        setError(
          "Corporate bridge not connected. Install/reload the AskAnything Chrome or Edge extension and connect to the VPN.",
        );
        setSending(false);
        return;
      }
      try {
        localKaResponse = await askKaViaExtension(text, {
          mode,
          customPrompt: mode === "custom" ? customPrompt : undefined,
        });
      } catch (bridgeError) {
        setBridgeConnected(false);
        setError((bridgeError as Error).message);
        setSending(false);
        return;
      }
    }

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId: activeId,
        message: text,
        mode,
        customPrompt: mode === "custom" ? customPrompt : undefined,
        localKaResponse,
      }),
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
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            <span>{error}</span>
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
                {bridgeRequired && (
                  <span
                    className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                      bridgeConnected
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {bridgeConnected
                      ? "Corporate bridge connected"
                      : "Corporate bridge required"}
                  </span>
                )}
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
                {mode === "custom" && (
                  <>
                    <label className="cursor-pointer rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-dark">
                      Upload .md
                      <input
                        type="file"
                        accept=".md,text/markdown"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const text = await file.text();
                          if (!text.trim()) {
                            setError("The custom prompt file is empty.");
                            return;
                          }
                          const trimmed = text.trim();
                          if (trimmed.length > MAX_CUSTOM_PROMPT_CHARS) {
                            setError(
                              `Custom prompt is too long (${trimmed.length.toLocaleString()} characters). Maximum: ${MAX_CUSTOM_PROMPT_CHARS.toLocaleString()}.`,
                            );
                            setCustomPrompt("");
                            setCustomPromptFileName("");
                            return;
                          }
                          setCustomPrompt(trimmed);
                          setCustomPromptFileName(file.name);
                          setError(null);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <span
                      className={`text-[11px] ${
                        customPrompt ? "text-brand" : "text-amber-600"
                      }`}
                    >
                      {customPrompt
                        ? `${customPromptFileName} loaded`
                        : "Upload a prompt before sending"}
                    </span>
                  </>
                )}
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
                  disabled={
                    sending ||
                    !input.trim() ||
                    (mode === "custom" && !customPrompt.trim())
                  }
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
