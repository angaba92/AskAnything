"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import * as XLSX from "xlsx";

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

interface KbSpreadsheetColumn {
  index: number;
  letter: string;
  label: string;
  display: string;
}

const QUESTION_HEADERS = ["question", "pregunta", "questions", "q", "prompt"];
const ANSWER_HEADERS = [
  "updated answer",
  "updated response",
  "respuesta actualizada",
  "revised answer",
  "approved answer",
  "answer",
  "respuesta",
  "answers",
  "a",
  "response",
  "reply",
];

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
  const [mappingOpen, setMappingOpen] = useState(false);
  const [pendingSpreadsheet, setPendingSpreadsheet] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [headerRow, setHeaderRow] = useState(1);
  const [columns, setColumns] = useState<KbSpreadsheetColumn[]>([]);
  const [questionColumn, setQuestionColumn] = useState("");
  const [answerColumn, setAnswerColumn] = useState("");
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const workbookRef = useRef<XLSX.WorkBook | null>(null);

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

  async function uploadFiles(
    files: File[],
    mapping?: {
      sheetName: string;
      headerRow: number;
      questionColumn: number;
      answerColumn: number;
    },
  ) {
    setUploading(true);
    setError(null);
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    if (mapping) {
      fd.set("sheetName", mapping.sheetName);
      fd.set("headerRow", String(mapping.headerRow));
      fd.set("questionColumn", String(mapping.questionColumn));
      fd.set("answerColumn", String(mapping.answerColumn));
    }
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

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const spreadsheets = files.filter((file) => /\.xlsx?$/i.test(file.name));
    if (spreadsheets.length > 0) {
      if (files.length !== 1) {
        setError(
          "Upload one spreadsheet at a time so its worksheet and columns can be mapped. PDF and DOCX files can still be uploaded together.",
        );
        if (fileRef.current) fileRef.current.value = "";
        return;
      }
      await openSpreadsheetMapping(spreadsheets[0]);
      return;
    }
    await uploadFiles(files);
  }

  async function openSpreadsheetMapping(file: File) {
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      if (workbook.SheetNames.length === 0) {
        throw new Error("The workbook has no worksheets.");
      }
      workbookRef.current = workbook;
      setPendingSpreadsheet(file);
      setSheetNames(workbook.SheetNames);
      configureSpreadsheet(workbook.SheetNames[0]);
      setMappingOpen(true);
      setError(null);
    } catch (err) {
      setError(`Could not read the spreadsheet: ${(err as Error).message}`);
    }
  }

  function configureSpreadsheet(sheetName: string, requestedHeaderRow?: number) {
    const worksheet = workbookRef.current?.Sheets[sheetName];
    if (!worksheet) return;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: "",
      raw: false,
    }).map((row) => row.map((cell) => String(cell ?? "")));
    const detectedHeaderRow =
      requestedHeaderRow ??
      detectHeaderRow(matrix);
    const nextHeaderRow = Math.max(
      1,
      Math.min(detectedHeaderRow, matrix.length || 1),
    );
    const header = matrix[nextHeaderRow - 1] ?? [];
    const maxColumns = Math.max(
      header.length,
      ...matrix.slice(nextHeaderRow - 1, nextHeaderRow + 6).map((row) => row.length),
    );
    const nextColumns = Array.from({ length: maxColumns }, (_, index) => {
      const label = String(header[index] ?? "").trim();
      const letter = XLSX.utils.encode_col(index);
      return {
        index,
        letter,
        label,
        display: `${letter} — ${label || "(empty)"}`,
      };
    });
    const normalized = (value: string) => value.trim().toLowerCase();
    const detectedQuestion = nextColumns.find((column) =>
      QUESTION_HEADERS.includes(normalized(column.label)),
    );
    const detectedAnswer = nextColumns.find((column) =>
      ANSWER_HEADERS.includes(normalized(column.label)),
    );

    setSelectedSheet(sheetName);
    setHeaderRow(nextHeaderRow);
    setColumns(nextColumns);
    setQuestionColumn(String(detectedQuestion?.index ?? ""));
    setAnswerColumn(String(detectedAnswer?.index ?? ""));
    setPreviewRows(matrix.slice(0, Math.min(matrix.length, nextHeaderRow + 6)));
  }

  function detectHeaderRow(matrix: string[][]): number {
    let bestIndex = 0;
    let bestScore = -1;
    matrix.slice(0, 30).forEach((row, index) => {
      const values = row.map((value) => value.trim().toLowerCase());
      const score =
        (values.some((value) => QUESTION_HEADERS.includes(value)) ? 6 : 0) +
        (values.some((value) => ANSWER_HEADERS.includes(value)) ? 5 : 0);
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    });
    return bestIndex + 1;
  }

  async function applySpreadsheetMapping() {
    if (
      !pendingSpreadsheet ||
      questionColumn === "" ||
      answerColumn === ""
    ) {
      setError("Select both the question and answer columns.");
      return;
    }
    setMappingOpen(false);
    await uploadFiles([pendingSpreadsheet], {
      sheetName: selectedSheet,
      headerRow,
      questionColumn: Number(questionColumn),
      answerColumn: Number(answerColumn),
    });
    setPendingSpreadsheet(null);
    workbookRef.current = null;
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
      {mappingOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="kb-mapping-title"
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <h2 id="kb-mapping-title" className="text-lg font-semibold text-gray-900">
                  Map knowledge-base columns
                </h2>
                <p className="mt-1 text-xs text-gray-500">
                  Choose exactly which questions and approved answers should be stored.
                  Updated Answer is preferred automatically when present.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMappingOpen(false);
                  setPendingSpreadsheet(null);
                  workbookRef.current = null;
                }}
                className="rounded-lg px-2 py-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close mapping"
              >
                ✕
              </button>
            </div>

            <div className="grid gap-4 border-b border-gray-200 bg-gray-50 p-5 md:grid-cols-4">
              <label>
                <span className="mb-1 block text-xs font-medium text-gray-600">
                  Worksheet
                </span>
                <select
                  value={selectedSheet}
                  onChange={(event) => configureSpreadsheet(event.target.value)}
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
                  onChange={(event) =>
                    configureSpreadsheet(
                      selectedSheet,
                      Number(event.target.value) || 1,
                    )
                  }
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
                />
              </label>
              <label>
                <span className="mb-1 block text-xs font-medium text-gray-600">
                  Question column
                </span>
                <select
                  value={questionColumn}
                  onChange={(event) => setQuestionColumn(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
                >
                  <option value="">Select…</option>
                  {columns.map((column) => (
                    <option key={column.index} value={column.index}>
                      {column.display}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-xs font-medium text-gray-600">
                  Approved answer column
                </span>
                <select
                  value={answerColumn}
                  onChange={(event) => setAnswerColumn(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
                >
                  <option value="">Select…</option>
                  {columns.map((column) => (
                    <option key={column.index} value={column.index}>
                      {column.display}
                    </option>
                  ))}
                </select>
              </label>
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
                          key={column.index}
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
                {pendingSpreadsheet?.name}
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
                  onClick={() => void applySpreadsheetMapping()}
                  disabled={
                    uploading || questionColumn === "" || answerColumn === ""
                  }
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  Import into library
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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
                Parsing &amp; indexing… (can take a while for big files)
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
