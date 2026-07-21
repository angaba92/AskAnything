"use client";

import { useState } from "react";
import Link from "next/link";
import { useBatch } from "@/components/BatchProvider";
import { ANSWER_MODES, MODE_LABELS, MODE_HINTS } from "@/lib/promptMapping";

export default function BatchPage() {
  const {
    rows,
    context,
    mode,
    backend,
    running,
    stopping,
    progress,
    error,
    doneCount,
    columns,
    questionCol,
    answerCol,
    fetching,
    startRow,
    setStartRow,
    setContext,
    setMode,
    setBackend,
    loadFile,
    loadFromUrl,
    setQuestionCol,
    setAnswerCol,
    run,
    stop,
    download,
  } = useBatch();

  const [url, setUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  }

  function isExcel(file: File) {
    // MIGRACIÓN: aceptamos también .csv/.ods (el Bulk CSV del KA). SheetJS
    // (XLSX.read) parsea todos estos formatos de forma nativa, así que no hace
    // falta convertir manualmente antes de mapear columnas.
    return /\.(xlsx|xls|csv|ods)$/i.test(file.name);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && isExcel(file)) loadFile(file);
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-brand-dark">Bulk import</h1>
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

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Answer style:</span>
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
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Backend:</span>
          {/* MIGRACIÓN: KA es el nuevo por defecto (recomendado). Agent y MCP
              se mantienen disponibles pero marcados "DO NOT USE" (backup). */}
          <div className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-xs">
            <button
              type="button"
              onClick={() => setBackend("ka")}
              disabled={running}
              className={`px-2.5 py-1 disabled:opacity-60 ${
                backend === "ka" ? "bg-brand text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Knowledge Assistant
            </button>
            <button
              type="button"
              onClick={() => setBackend("agent")}
              disabled={running}
              title="Deprecated — backup only. Do not use."
              className={`border-l border-gray-300 px-2.5 py-1 disabled:opacity-60 ${
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
              disabled={running}
              title="Deprecated — backup only. Do not use."
              className={`border-l border-gray-300 px-2.5 py-1 disabled:opacity-60 ${
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
              ? "DY Knowledge Assistant — grounded, cited answers (recommended, works on Vercel)"
              : backend === "mcp"
              ? "Backup only · corporate network — run locally, not on Vercel"
              : "Backup only · Experience OS agent · rotates DY sections/threads"}
          </span>
        </div>

        {/* Source: drag & drop / upload OR OneDrive link */}
        <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
              dragOver
                ? "border-brand bg-brand/5"
                : "border-gray-300 bg-white"
            }`}
          >
            <p className="text-sm text-gray-600">
              <b>Drag &amp; drop</b> your spreadsheet here
              <span className="text-gray-400"> — .xlsx, .xls, .csv or .ods, e.g. straight from your synced OneDrive folder</span>
            </p>
            <p className="text-xs text-gray-400">or</p>
            <label className="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Choose file
              <input
                type="file"
                accept=".xlsx,.xls,.csv,.ods"
                onChange={handleFile}
                className="hidden"
              />
            </label>
            <span className="text-xs text-gray-500">
              {rows.length > 0
                ? `${rows.length} questions loaded`
                : "Accepted: .xlsx, .xls, .csv, .ods"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-[11px] uppercase tracking-wide text-gray-400">
              or paste a public OneDrive / SharePoint link
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
            Only works for links shared as <b>“anyone with the link”</b>. Links
            restricted to <b>Mastercard sign-in cannot be imported
            automatically</b> (they require a Microsoft login the server doesn’t
            have) — download the file and drag it in instead.
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

        <div className="flex flex-wrap items-center gap-3">
          {rows.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-gray-600">
              Start from row
              <input
                type="number"
                min={1}
                max={rows.length}
                value={startRow}
                onChange={(e) => setStartRow(parseInt(e.target.value, 10))}
                disabled={running}
                className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none disabled:opacity-50"
              />
              <span className="text-[11px] text-gray-400">of {rows.length}</span>
            </label>
          )}
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
              disabled={stopping}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
            >
              {stopping ? "Stopping…" : "Stop"}
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
                          : r.status === "skipped"
                          ? "bg-blue-100 text-blue-700"
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
