"use client";

import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as XLSX from "xlsx";

export interface BatchRow {
  question: string;
  answer: string;
  expert: string;
  sources: string;
  status: "pending" | "running" | "done" | "error";
  [key: string]: string;
}

interface BatchContextValue {
  rows: BatchRow[];
  context: string;
  mode: BatchMode;
  fileName: string;
  running: boolean;
  progress: number;
  error: string | null;
  doneCount: number;
  setContext: (v: string) => void;
  setMode: (v: BatchMode) => void;
  loadFile: (file: File) => void;
  run: () => Promise<void>;
  stop: () => void;
  download: () => void;
}

export type BatchMode = "simple" | "detailed" | "bulleted";

const QUESTION_KEYS = ["question", "pregunta", "questions", "q"];

const BatchContext = createContext<BatchContextValue | null>(null);

export function useBatch() {
  const ctx = useContext(BatchContext);
  if (!ctx) throw new Error("useBatch must be used within <BatchProvider>");
  return ctx;
}

export default function BatchProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [context, setContext] = useState("");
  const [mode, setMode] = useState<BatchMode>("detailed");
  const [fileName, setFileName] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);
  // Refs so the long-running loop always reads the latest values, even if the
  // user edits the context/style while it runs in the background.
  const rowsRef = useRef<BatchRow[]>([]);
  const contextRef = useRef("");
  const modeRef = useRef<BatchMode>("detailed");

  rowsRef.current = rows;
  contextRef.current = context;
  modeRef.current = mode;

  function loadFile(file: File) {
    setError(null);
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
        const cols = Object.keys(json[0]);
        const qCol =
          cols.find((c) => QUESTION_KEYS.includes(c.trim().toLowerCase())) ??
          cols[0];
        const parsed: BatchRow[] = json
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
    if (rowsRef.current.length === 0 || running) return;
    setRunning(true);
    setError(null);
    stopRef.current = false;

    const total = rowsRef.current.length;
    for (let i = 0; i < total; i++) {
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
          body: JSON.stringify({
            question: rowsRef.current[i].question,
            context: contextRef.current,
            mode: modeRef.current,
          }),
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
        if (/sesi[oó]n|session|cookie|xsrf|caduc/i.test((err as Error).message)) {
          setError((err as Error).message);
          break;
        }
      }
      setProgress(i + 1);
      await new Promise((r) => setTimeout(r, 600));
    }
    setRunning(false);
  }

  function stop() {
    stopRef.current = true;
  }

  function download() {
    const out = rowsRef.current.map((r) => ({
      question: r.question,
      answer: r.answer,
      expert: r.expert,
      sources: r.sources,
      status: r.status,
    }));
    const ws = XLSX.utils.json_to_sheet(out);
    ws["!cols"] = [
      { wch: 40 },
      { wch: 80 },
      { wch: 16 },
      { wch: 20 },
      { wch: 10 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "answers");
    XLSX.writeFile(wb, fileName.replace(/\.xlsx?$/i, "") + "_answered.xlsx");
  }

  const doneCount = rows.filter((r) => r.status === "done").length;

  const value: BatchContextValue = {
    rows,
    context,
    mode,
    fileName,
    running,
    progress,
    error,
    doneCount,
    setContext,
    setMode,
    loadFile,
    run,
    stop,
    download,
  };

  return (
    <BatchContext.Provider value={value}>
      {children}
      <BatchFloatingIndicator />
    </BatchContext.Provider>
  );
}

/**
 * Small floating badge shown on every page while a batch is running (or just
 * finished) so the user can leave /batch, work in another conversation, and
 * still see progress / jump back.
 */
function BatchFloatingIndicator() {
  const { rows, running, progress, doneCount } = useBatch();
  const pathname = usePathname();

  if (pathname === "/batch") return null;
  if (rows.length === 0) return null;
  if (!running && progress >= rows.length && doneCount === 0) return null;

  return (
    <Link
      href="/batch"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm shadow-lg hover:bg-gray-50"
    >
      {running ? (
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
      ) : (
        <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
      )}
      <span className="font-medium text-brand-dark">
        Batch {running ? "running" : "finished"}
      </span>
      <span className="text-gray-500">
        {progress}/{rows.length}
      </span>
    </Link>
  );
}
