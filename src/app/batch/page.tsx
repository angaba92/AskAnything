"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";

interface Row {
  question: string;
  answer: string;
  expert: string;
  sources: string;
  status: "pending" | "running" | "done" | "error";
  [key: string]: string;
}

const QUESTION_KEYS = ["question", "pregunta", "questions", "q"];

export default function BatchPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [context, setContext] = useState("");
  const [detailed, setDetailed] = useState(false);
  const [fileName, setFileName] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
          defval: "",
        });
        if (json.length === 0) {
          setError("The sheet is empty.");
          return;
        }
        // Detecta la columna de preguntas (por nombre o la primera columna).
        const cols = Object.keys(json[0]);
        const qCol =
          cols.find((c) => QUESTION_KEYS.includes(c.trim().toLowerCase())) ??
          cols[0];
        const parsed: Row[] = json
          .map((r) => ({
            ...r,
            question: String(r[qCol] ?? "").trim(),
            answer: String(r["answer"] ?? r["respuesta"] ?? ""),
            expert: "",
            sources: "",
            status: "pending" as const,
          }))
          .filter((r) => r.question.length > 0);
        setRows(parsed);
        setProgress(0);
      } catch (err) {
        setError("Could not read the file: " + (err as Error).message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function run() {
    if (rows.length === 0 || running) return;
    setRunning(true);
    setError(null);
    stopRef.current = false;

    for (let i = 0; i < rows.length; i++) {
      if (stopRef.current) break;
      setRows((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], status: "running" };
        return next;
      });

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: rows[i].question, context, structured: detailed }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error");
        setRows((prev) => {
          const next = [...prev];
          next[i] = {
            ...next[i],
            answer: data.answer,
            expert: data.expert,
            sources: data.tools,
            status: "done",
          };
          return next;
        });
      } catch (err) {
        setRows((prev) => {
          const next = [...prev];
          next[i] = {
            ...next[i],
            answer: "ERROR: " + (err as Error).message,
            status: "error",
          };
          return next;
        });
        // Si es auth, paramos todo el lote.
        if (/sesi[oó]n|session|cookie|xsrf|caduc/i.test((err as Error).message)) {
          setError((err as Error).message);
          break;
        }
      }
      setProgress(i + 1);
      // Pequeña pausa para no saturar el backend / rate limits.
      await new Promise((r) => setTimeout(r, 600));
    }
    setRunning(false);
  }

  function download() {
    const out = rows.map((r) => ({
      question: r.question,
      answer: r.answer,
      expert: r.expert,
      sources: r.sources,
      status: r.status,
    }));
    const ws = XLSX.utils.json_to_sheet(out);
    ws["!cols"] = [{ wch: 40 }, { wch: 80 }, { wch: 16 }, { wch: 20 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "answers");
    XLSX.writeFile(wb, fileName.replace(/\.xlsx?$/i, "") + "_answered.xlsx");
  }

  const doneCount = rows.filter((r) => r.status === "done").length;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-brand-dark">Batch Excel</h1>
        <Link href="/" className="text-sm text-brand hover:underline">
          ← Back to chat
        </Link>
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
              onClick={() => setDetailed(true)}
              className={`px-2.5 py-1 ${
                detailed ? "bg-brand text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Detailed
            </button>
            <button
              type="button"
              onClick={() => setDetailed(false)}
              className={`px-2.5 py-1 ${
                !detailed ? "bg-brand text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Simple
            </button>
          </div>
          <span className="text-[11px] text-gray-400">
            {detailed
              ? "Structured: Summary · Details · References"
              : "Short, direct answer (best for spreadsheet cells)"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFile}
            className="text-sm"
          />
          <span className="text-sm text-gray-500">
            {rows.length > 0 ? `${rows.length} questions loaded` : "Column 'question' (or first column)"}
          </span>
        </div>

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
              onClick={() => (stopRef.current = true)}
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
