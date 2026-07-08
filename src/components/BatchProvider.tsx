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
  status: "pending" | "running" | "done" | "error" | "skipped";
  [key: string]: string;
}

export type BatchMode = "simple" | "detailed" | "bulleted";

interface BatchContextValue {
  rows: BatchRow[];
  context: string;
  mode: BatchMode;
  fileName: string;
  running: boolean;
  stopping: boolean;
  progress: number;
  error: string | null;
  doneCount: number;
  columns: string[];
  questionCol: string;
  answerCol: string;
  fetching: boolean;
  startRow: number;
  setStartRow: (v: number) => void;
  setContext: (v: string) => void;
  setMode: (v: BatchMode) => void;
  loadFile: (file: File) => void;
  loadFromUrl: (url: string) => Promise<void>;
  setQuestionCol: (c: string) => void;
  setAnswerCol: (c: string) => void;
  run: () => Promise<void>;
  stop: () => void;
  download: () => void;
}

const QUESTION_KEYS = ["question", "pregunta", "questions", "q", "prompt"];
const ANSWER_KEYS = ["answer", "respuesta", "answers", "a", "response", "reply"];

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
  const [stopping, setStopping] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [questionCol, setQuestionColState] = useState("");
  const [answerCol, setAnswerColState] = useState("");
  const [startRow, setStartRowState] = useState(1);
  const stopRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // Refs so the long-running loop always reads the latest values, even if the
  // user edits the context/style while it runs in the background.
  const rowsRef = useRef<BatchRow[]>([]);
  const contextRef = useRef("");
  const modeRef = useRef<BatchMode>("detailed");
  const rawRef = useRef<Record<string, unknown>[]>([]);
  const answerColRef = useRef("");
  const startRowRef = useRef(1);

  rowsRef.current = rows;
  contextRef.current = context;
  modeRef.current = mode;
  answerColRef.current = answerCol;
  startRowRef.current = startRow;

  function detectColumn(cols: string[], keys: string[]): string {
    return (
      cols.find((c) => keys.includes(c.trim().toLowerCase())) ?? ""
    );
  }

  function buildRows(
    raw: Record<string, unknown>[],
    qCol: string,
    aCol: string,
  ): BatchRow[] {
    return raw
      .map((r) => {
        const answer = aCol ? String(r[aCol] ?? "") : "";
        return {
          ...r,
          question: String(r[qCol] ?? "").trim(),
          answer,
          expert: "",
          sources: "",
          status: (answer.trim().length > 0 ? "skipped" : "pending") as
            | "pending"
            | "skipped",
        };
      })
      .filter((r) => r.question.length > 0);
  }

  function ingestArrayBuffer(buffer: ArrayBuffer, name: string) {
    const wb = XLSX.read(buffer, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: "",
    });
    if (json.length === 0) {
      setError("The sheet is empty.");
      return;
    }
    const cols = Object.keys(json[0]);
    const qCol = detectColumn(cols, QUESTION_KEYS) || cols[0];
    const aCol = detectColumn(cols, ANSWER_KEYS);

    rawRef.current = json;
    setColumns(cols);
    setQuestionColState(qCol);
    setAnswerColState(aCol);
    setFileName(name);
    const built = buildRows(json, qCol, aCol);
    setRows(built);
    const firstPending = built.findIndex((r) => r.status === "pending");
    const startIdx = firstPending === -1 ? 0 : firstPending;
    setStartRowState(Math.max(1, startIdx + 1));
    setProgress(0);
    setError(null);
  }

  function loadFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        ingestArrayBuffer(ev.target?.result as ArrayBuffer, file.name);
      } catch (err) {
        setError("Could not read the file: " + (err as Error).message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function loadFromUrl(url: string) {
    const link = url.trim();
    if (!link) return;
    setError(null);
    setFetching(true);
    try {
      const res = await fetch("/api/batch/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: link }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const buf = await res.arrayBuffer();
      // Derive a filename from the URL if possible.
      let name = "onedrive.xlsx";
      try {
        const last = new URL(link).pathname.split("/").filter(Boolean).pop();
        if (last && /\.xlsx?$/i.test(last)) name = decodeURIComponent(last);
      } catch {
        /* ignore */
      }
      ingestArrayBuffer(buf, name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFetching(false);
    }
  }

  function setStartRow(v: number) {
    const total = rowsRef.current.length;
    const clamped = Math.max(1, Math.min(v || 1, total || 1));
    setStartRowState(clamped);
  }

  function setQuestionCol(c: string) {
    setQuestionColState(c);
    const built = buildRows(rawRef.current, c, answerColRef.current);
    setRows(built);
    const firstPending = built.findIndex((r) => r.status === "pending");
    setStartRowState(Math.max(1, (firstPending === -1 ? 0 : firstPending) + 1));
    setProgress(0);
  }

  function setAnswerCol(c: string) {
    setAnswerColState(c);
    const built = buildRows(rawRef.current, questionCol, c);
    setRows(built);
    const firstPending = built.findIndex((r) => r.status === "pending");
    setStartRowState(Math.max(1, (firstPending === -1 ? 0 : firstPending) + 1));
    setProgress(0);
  }

  async function run() {
    if (rowsRef.current.length === 0 || running) return;
    setRunning(true);
    setStopping(false);
    setError(null);
    stopRef.current = false;

    // Espera que se puede interrumpir al instante si el usuario pulsa Stop.
    const interruptibleSleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const step = 100;
        let waited = 0;
        const id = setInterval(() => {
          waited += step;
          if (stopRef.current || waited >= ms) {
            clearInterval(id);
            resolve();
          }
        }, step);
      });

    const total = rowsRef.current.length;
    const start = Math.max(0, Math.min(startRowRef.current - 1, total));
    setProgress(start);

    // Pausa base entre filas (ms) + ralentización adaptativa: si DY empieza a
    // fallar, aumentamos la espera para no saturarlo; al ir bien, la bajamos.
    const BASE_DELAY = 1200;
    let consecutiveErrors = 0;

    for (let i = start; i < total; i++) {
      if (stopRef.current) break;

      const aCol = answerColRef.current;
      const existing = String(rowsRef.current[i].answer ?? "").trim();
      if (aCol && existing.length > 0) {
        setRows((prev) => {
          const next = [...prev];
          next[i] = { ...next[i], status: "skipped" };
          return next;
        });
        setProgress(i + 1);
        continue;
      }

      setRows((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], status: "running" };
        return next;
      });

      let rowFailed = false;
      try {
        const controller = new AbortController();
        abortRef.current = controller;
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question: rowsRef.current[i].question,
            context: contextRef.current,
            mode: modeRef.current,
          }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error");
        // Si pararon mientras llegaba la respuesta, no la escribimos como done.
        if (stopRef.current) {
          setRows((prev) => {
            const next = [...prev];
            if (next[i].status === "running")
              next[i] = { ...next[i], status: "pending" };
            return next;
          });
          break;
        }
        setRows((prev) => {
          const next = [...prev];
          const writeCol = answerColRef.current;
          next[i] = {
            ...next[i],
            answer: data.answer,
            expert: data.expert,
            sources: data.tools,
            status: "done",
            ...(writeCol ? { [writeCol]: data.answer } : {}),
          };
          return next;
        });
      } catch (err) {
        // Abortado por el usuario (Stop): revertir a pending y salir sin marcar error.
        if ((err as Error).name === "AbortError" || stopRef.current) {
          setRows((prev) => {
            const next = [...prev];
            if (next[i].status === "running")
              next[i] = { ...next[i], status: "pending" };
            return next;
          });
          break;
        }
        rowFailed = true;
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
      } finally {
        abortRef.current = null;
      }
      setProgress(i + 1);
      if (stopRef.current) break;

      // Ralentización adaptativa: cada fallo dobla la espera (hasta ~15s);
      // cada acierto la reduce. Así aliviamos a DY cuando empieza a saturarse.
      if (rowFailed) consecutiveErrors++;
      else consecutiveErrors = Math.max(0, consecutiveErrors - 1);
      const backoff = Math.min(BASE_DELAY * 2 ** consecutiveErrors, 15000);
      const jitter = backoff * (0.8 + Math.random() * 0.4);
      await interruptibleSleep(jitter);
      if (stopRef.current) break;
    }
    setRunning(false);
    setStopping(false);
  }

  function stop() {
    stopRef.current = true;
    setStopping(true);
    abortRef.current?.abort();
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

  const doneCount = rows.filter(
    (r) => r.status === "done" || r.status === "skipped",
  ).length;

  const value: BatchContextValue = {
    rows,
    context,
    mode,
    fileName,
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
    loadFile,
    loadFromUrl,
    setQuestionCol,
    setAnswerCol,
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
