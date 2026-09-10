"use client";

import { useState } from "react";
import Link from "next/link";
import { useBatch } from "@/components/BatchProvider";
import { ANSWER_MODES, MODE_LABELS, MODE_HINTS } from "@/lib/promptMapping";
import { MAX_CUSTOM_PROMPT_CHARS } from "@/lib/promptMapping";

export default function BatchPage() {
  const {
    rows,
    context,
    mode,
    running,
    stopping,
    progress,
    error,
    doneCount,
    columns,
    sheetNames,
    selectedSheet,
    headerRow,
    mappingOpen,
    previewRows,
    questionCol,
    answerCol,
    reviewCol,
    newAnswerColumnName,
    newReviewColumnName,
    customPrompt,
    customPromptFileName,
    fetching,
    startRow,
    setStartRow,
    setContext,
    setMode,
    loadFile,
    loadFromUrl,
    setSelectedSheet,
    setHeaderRow,
    setMappingOpen,
    setQuestionCol,
    setAnswerCol,
    setReviewCol,
    setNewAnswerColumnName,
    setNewReviewColumnName,
    loadCustomPrompt,
    clearCustomPrompt,
    applyMapping,
    updateReview,
    approveReview,
    clearAllReviews,
    run,
    stop,
    download,
  } = useBatch();

  const [url, setUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const reviewCount = rows.filter(
    (row) => row.review.trim() && !row.reviewApproved,
  ).length;

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
      {mappingOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mapping-title"
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 id="mapping-title" className="text-lg font-semibold text-gray-900">
                  Map spreadsheet columns
                </h2>
                <p className="mt-1 text-xs text-gray-500">
                  Choose the worksheet and the row containing the real headers. Column
                  letters are shown so empty or duplicated headers remain selectable.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMappingOpen(false)}
                className="rounded-lg px-2 py-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close mapping"
              >
                ✕
              </button>
            </div>

            <div className="grid gap-4 border-b border-gray-200 bg-gray-50 p-5 md:grid-cols-5">
              <label className="md:col-span-2">
                <span className="mb-1 block text-xs font-medium text-gray-600">
                  Worksheet
                </span>
                <select
                  value={selectedSheet}
                  onChange={(e) => setSelectedSheet(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
                >
                  {sheetNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-xs font-medium text-gray-600">
                  Header row
                </span>
                <input
                  type="number"
                  min={1}
                  value={headerRow}
                  onChange={(e) => setHeaderRow(Number(e.target.value) || 1)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-medium text-gray-600">
                  Question column
                </span>
                <select
                  value={questionCol}
                  onChange={(e) => setQuestionCol(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
                >
                  <option value="">Select…</option>
                  {columns.map((column) => (
                    <option key={column.key} value={column.key}>
                      {column.display}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-xs font-medium text-gray-600">
                  Answer column
                </span>
                <select
                  value={answerCol}
                  onChange={(e) => setAnswerCol(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
                >
                  <option value="">Create a new column</option>
                  {columns.map((column) => (
                    <option key={column.key} value={column.key}>
                      {column.display}
                    </option>
                  ))}
                </select>
              </label>
              {!answerCol && (
                <label className="md:col-start-4">
                  <span className="mb-1 block text-xs font-medium text-gray-600">
                    New answer column name
                  </span>
                  <input
                    value={newAnswerColumnName}
                    onChange={(e) => setNewAnswerColumnName(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
                  />
                </label>
              )}
              <label className={answerCol ? "md:col-start-4" : ""}>
                <span className="mb-1 block text-xs font-medium text-gray-600">
                  Review column
                </span>
                <select
                  value={reviewCol}
                  onChange={(e) => setReviewCol(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
                >
                  <option value="">Create a new column</option>
                  {columns.map((column) => (
                    <option key={column.key} value={column.key}>
                      {column.display}
                    </option>
                  ))}
                </select>
              </label>
              {!reviewCol && (
                <label>
                  <span className="mb-1 block text-xs font-medium text-gray-600">
                    New review column name
                  </span>
                  <input
                    value={newReviewColumnName}
                    onChange={(e) => setNewReviewColumnName(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
                  />
                </label>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-5">
              <p className="mb-2 text-xs font-medium text-gray-600">
                Worksheet preview — selected header row highlighted
              </p>
              <table className="min-w-full border-collapse text-xs">
                <tbody>
                  {previewRows.map((row, rowIndex) => (
                    <tr
                      key={rowIndex}
                      className={
                        rowIndex === headerRow - 1
                          ? "bg-brand/10 font-semibold text-brand-dark"
                          : "text-gray-600"
                      }
                    >
                      <td className="sticky left-0 border border-gray-200 bg-gray-50 px-2 py-1 text-gray-400">
                        {rowIndex + 1}
                      </td>
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className="max-w-xs truncate border border-gray-200 px-2 py-1"
                          title={row[column.index] ?? ""}
                        >
                          <span className="mr-1 text-[10px] text-gray-400">
                            {column.letter}
                          </span>
                          {row[column.index] || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-gray-200 px-5 py-4">
              <span className="text-xs text-gray-500">
                Header rows are auto-detected per worksheet; verify the highlighted
                row in the preview before applying.
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMappingOpen(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={applyMapping}
                  disabled={!questionCol}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  Apply mapping
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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

        {mode === "custom" && (
          <div className="rounded-lg border border-brand/30 bg-brand/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-800">
                  Custom system instructions
                </p>
                <p className="text-xs text-gray-500">
                  The uploaded Markdown replaces all built-in style instructions and
                  response guardrails for this mode. Maximum{" "}
                  {MAX_CUSTOM_PROMPT_CHARS.toLocaleString()} characters. Custom adds
                  no hidden guardrails or confidence metadata.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="cursor-pointer rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark">
                  Upload .md
                  <input
                    type="file"
                    accept=".md,text/markdown"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void loadCustomPrompt(file);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                {customPrompt && (
                  <button
                    type="button"
                    onClick={clearCustomPrompt}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            {customPrompt ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-brand">
                  {customPromptFileName} · {customPrompt.length.toLocaleString()} characters
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs text-gray-600">
                  {customPrompt}
                </pre>
              </details>
            ) : (
              <p className="mt-3 text-xs font-medium text-amber-700">
                Upload a non-empty .md file before starting.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Knowledge source:</span>
          <span className="rounded-lg bg-brand px-2.5 py-1 text-xs text-white">
            Knowledge Assistant
          </span>
          <span className="text-[11px] text-gray-400">
            Uses the Dynamic Yield Knowledge Assistant.
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

        {columns.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3">
            <div>
              <p className="text-sm font-medium text-gray-700">
                {selectedSheet} · header row {headerRow}
              </p>
              <p className="text-xs text-gray-400">
                Question: {columns.find((c) => c.key === questionCol)?.display ?? "not selected"} ·
                Answer: {columns.find((c) => c.key === answerCol)?.display ?? `new “${newAnswerColumnName}”`} ·
                Review: {columns.find((c) => c.key === reviewCol)?.display ?? `new “${newReviewColumnName}”`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMappingOpen(true)}
              disabled={running}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              Configure mapping
            </button>
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
          {/* Botón único que alterna Start ⇄ Stop: mientras corre, el MISMO botón
              se vuelve rojo y dice "Stop" (antes quedaba deshabilitado como
              "Running…" y el Stop era otro botón aparte → confuso). El progreso
              sigue visible en la barra inferior y en el propio botón. */}
          {running ? (
            <button
              onClick={stop}
              disabled={stopping}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            >
              {stopping ? "Stopping…" : `Stop · ${progress}/${rows.length}`}
            </button>
          ) : (
            <button
              onClick={run}
              disabled={
                rows.length === 0 || (mode === "custom" && !customPrompt.trim())
              }
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              Start
            </button>
          )}
          <button
            onClick={download}
            disabled={doneCount === 0}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Download .xlsx
          </button>
          {reviewCount > 0 && (
            <>
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                {reviewCount} need review
              </span>
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      "Clear every review flag in the current batch? This cannot be undone.",
                    )
                  ) {
                    clearAllReviews();
                  }
                }}
                disabled={running}
                className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
              >
                Clear all review flags
              </button>
            </>
          )}
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
          <table className="w-full table-fixed text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="w-10 p-2">#</th>
                <th className="w-[25%] p-2">Question</th>
                <th className="w-[39%] p-2">Answer</th>
                <th className="w-[28%] p-2">Needs Review</th>
                <th className="w-[8%] p-2">Status</th>
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
                  <td className="p-3">
                    <div
                      className={`rounded-xl border p-2 ${
                        r.reviewApproved
                          ? "border-green-300 bg-green-50"
                          : r.review
                            ? "border-amber-300 bg-amber-50"
                            : "border-gray-200 bg-white"
                      }`}
                    >
                      <textarea
                        value={r.review}
                        onChange={(e) => updateReview(i, e.target.value)}
                        placeholder="No review required"
                        rows={5}
                        className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand focus:outline-none"
                      />
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span
                          className={`text-xs font-medium ${
                            r.reviewApproved
                              ? "text-green-700"
                              : r.review
                                ? "text-amber-800"
                                : "text-gray-400"
                          }`}
                        >
                          {r.reviewApproved
                            ? "Approved"
                            : r.review
                              ? "Pending approval"
                              : "No review flag"}
                        </span>
                        <button
                          type="button"
                          onClick={() => approveReview(i)}
                          disabled={!r.review.trim() || r.reviewApproved}
                          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          ✓ Approve
                        </button>
                      </div>
                    </div>
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
