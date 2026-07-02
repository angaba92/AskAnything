"use client";

import { useState } from "react";
import Link from "next/link";
import { useBatch } from "@/components/BatchProvider";

export default function BatchPage() {
  const {
    rows,
    context,
    mode,
    running,
    progress,
    error,
    doneCount,
    columns,
    questionCol,
    answerCol,
    fetching,
    setContext,
    setMode,
    loadFile,
    loadFromUrl,
    setQuestionCol,
    setAnswerCol,
    run,
    stop,
    download,
  } = useBatch();

  const [url, setUrl] = useState("");

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-brand-dark">Batch Excel</h1>
        <Link href="/" className="text-sm text-brand hover:underline">
          ← Back to chat
        </Link>
      </div>

      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-700">
        The batch keeps running in the background if you switch to another
        conversation. A floating badge (bottom-right) shows progress and brings
        you back here.
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
        <div>
          <label className="mb-1 block text-sm font-medium">
            Company / industry context (applied to every question)
          </label>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={2}
            placeholder="e.g. You are answering for Acme, a luxury retail brand using Dynamic Yield."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Answer style:</span>
          <div className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-xs">
            <button
              type="button"
              onClick={() => setMode("detailed")}
              className={`px-2.5 py-1 ${
                mode === "detailed" ? "bg-brand text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Detailed
            </button>
            <button
              type="button"
              onClick={() => setMode("bulleted")}
              className={`border-l border-gray-300 px-2.5 py-1 ${
                mode === "bulleted" ? "bg-brand text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Detailed (bullets)
            </button>
            <button
              type="button"
              onClick={() => setMode("simple")}
              className={`border-l border-gray-300 px-2.5 py-1 ${
                mode === "simple" ? "bg-brand text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Simple
            </button>
          </div>
          <span className="text-[11px] text-gray-400">
            {mode === "detailed"
              ? "Structured: Summary · Details · Example · References"
              : mode === "bulleted"
              ? "Structured: Summary · bullet Details · Example · References"
              : "Short, direct answer (best for spreadsheet cells)"}
          </span>
        </div>

        {/* Source: upload OR OneDrive/SharePoint link */}
        <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFile}
              className="text-sm"
            />
            <span className="text-sm text-gray-500">
              {rows.length > 0
                ? `${rows.length} questions loaded`
                : "Upload a file…"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-[11px] uppercase tracking-wide text-gray-400">
              or paste a OneDrive / SharePoint link
            </span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…-my.sharepoint.com/:x:/g/personal/…"
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
            <button
              type="button"
              onClick={() => loadFromUrl(url)}
              disabled={fetching || !url.trim()}
              className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {fetching ? "Loading…" : "Load from link"}
            </button>
          </div>
          <p className="text-[11px] text-gray-400">
            The link must be shared as <b>“anyone with the link”</b>. Corporate
            links that require sign-in cannot be downloaded automatically —
            upload the file instead.
          </p>
        </div>

        {/* Column mapping (shown once a file is loaded) */}
        {columns.length > 0 && (
          <div className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Question column
              </label>
              <select
                value={questionCol}
                onChange={(e) => setQuestionCol(e.target.value)}
                className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
              >
                {columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Answer column (where answers are written)
              </label>
              <select
                value={answerCol}
                onChange={(e) => setAnswerCol(e.target.value)}
                className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
              >
                <option value="">New “answer” column</option>
                {columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <span className="pb-1.5 text-[11px] text-gray-400">
              Auto-detected — change if your template uses different headers.
            </span>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={run}
            disabled={running || rows.length === 0}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {running ? `Running… ${progress}/${rows.length}` : "Start"}
          </button>
          {running && (
            <button
              onClick={stop}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
            >
              Stop
            </button>
          )}
          <button
            onClick={download}
            disabled={doneCount === 0}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Download .xlsx
          </button>
        </div>

        {rows.length > 0 && (
          <div className="h-2 w-full overflow-hidden rounded bg-gray-100">
            <div
              className="h-full bg-brand transition-all"
              style={{ width: `${(progress / rows.length) * 100}%` }}
            />
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="mt-5 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="w-8 p-2">#</th>
                <th className="p-2">Question</th>
                <th className="p-2">Answer</th>
                <th className="w-24 p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-gray-100 align-top">
                  <td className="p-2 text-gray-400">{i + 1}</td>
                  <td className="p-2">{r.question}</td>
                  <td className="whitespace-pre-wrap p-2 text-gray-700">
                    {r.answer}
                  </td>
                  <td className="p-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        r.status === "done"
                          ? "bg-green-100 text-green-700"
                          : r.status === "running"
                          ? "bg-amber-100 text-amber-700"
                          : r.status === "error"
                          ? "bg-red-100 text-red-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
