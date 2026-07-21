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

export type BatchMode = "simple" | "detailed" | "bulleted" | "loopio";
// MIGRACIÓN: "ka" (DY Knowledge Assistant) es el nuevo backend por defecto.
// "agent" y "mcp" permanecen como backup ("DO NOT USE").
export type BatchBackend = "ka" | "agent" | "mcp";

interface BatchContextValue {
  rows: BatchRow[];
  context: string;
  mode: BatchMode;
  backend: BatchBackend;
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
  setBackend: (v: BatchBackend) => void;
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
// Secciones DY entre las que rota el batch. Cada sección resuelve (server-side)
// a un THREAD distinto y persistente. DY no ofrece reset de hilo, así que la
// única forma de no saturar un hilo con cientos de mensajes es repartir las
// preguntas entre varias secciones: cada hilo crece N veces más lento.
const BATCH_SECTIONS = ["8787656", "8775500", "8794611"];

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
  const [backend, setBackend] = useState<BatchBackend>("ka");
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
  const rowAttempts = useRef<Record<number, number>>({});
  // Rotación de secciones: repartimos las preguntas entre BATCH_SECTIONS. Cada
  // sección tiene su propio hilo persistente en DY, que cacheamos aquí para no
  // recrearlo en cada pregunta. `rotation` avanza en cada intento para ir
  // saltando de sección (y de hilo) → ninguna se satura y, si un hilo queda en
  // mal estado, el siguiente intento cae en otro distinto.
  const sectionThreads = useRef<Record<string, string>>({});
  const rotation = useRef(0);
  // MIGRACIÓN KA: salud del backend Knowledge Assistant DURANTE esta ejecución.
  // Si el KA ya respondió al menos una vez, cualquier "unreachable/timeout"
  // posterior se trata como un blip transitorio (rate-limit / corte breve a gran
  // escala) y dejamos que el circuit breaker haga cooldown y reintente la MISMA
  // fila, en vez de abortar todo el batch por una caída puntual. Solo paramos en
  // seco si el KA NUNCA respondió y encadena varios fallos → problema real de
  // config/red (p. ej. KA_URL apuntando al entorno dev interno).
  const kaHealthyRef = useRef(false);
  const kaUnreachableStreakRef = useRef(0);
  // Refs so the long-running loop always reads the latest values, even if the
  // user edits the context/style while it runs in the background.
  const rowsRef = useRef<BatchRow[]>([]);
  const contextRef = useRef("");
  const modeRef = useRef<BatchMode>("detailed");
  const backendRef = useRef<BatchBackend>("ka");
  const rawRef = useRef<Record<string, unknown>[]>([]);
  const answerColRef = useRef("");
  const startRowRef = useRef(1);

  rowsRef.current = rows;
  contextRef.current = context;
  modeRef.current = mode;
  backendRef.current = backend;
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
    rowAttempts.current = {};
    sectionThreads.current = {};
    rotation.current = 0;
    kaHealthyRef.current = false;
    kaUnreachableStreakRef.current = 0;

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
    // KA (por defecto) y el agente son rápidos (~1-2s) → pausa corta. El backend
    // MCP (get_dy_knowledge) es lento (~25-40s) y se rate-limita tras ~2 llamadas
    // seguidas: le damos una pausa base mucho mayor entre filas.
    const BASE_DELAY = backendRef.current === "mcp" ? 30000 : 1200;
    let consecutiveErrors = 0;

    // Procesa una fila. Devuelve "done" | "error" | "stopped".
    async function processRow(i: number): Promise<"done" | "error" | "stopped"> {
      setRows((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], status: "running" };
        return next;
      });

      try {
        const controller = new AbortController();
        abortRef.current = controller;
        // Sección (y por tanto hilo) de esta pregunta. Rotamos en cada intento.
        const section = BATCH_SECTIONS[rotation.current % BATCH_SECTIONS.length];
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question: rowsRef.current[i].question,
            context: contextRef.current,
            mode: modeRef.current,
            backend: backendRef.current,
            sectionId: section,
            threadId: sectionThreads.current[section] ?? undefined,
          }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error");
        if (stopRef.current) {
          setRows((prev) => {
            const next = [...prev];
            if (next[i].status === "running")
              next[i] = { ...next[i], status: "pending" };
            return next;
          });
          return "stopped";
        }
        // Cacheamos el hilo de esta sección y avanzamos la rotación para que la
        // siguiente pregunta caiga en otra sección/hilo distintos.
        if (data.threadId) sectionThreads.current[section] = data.threadId;
        rotation.current += 1;
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
        // MIGRACIÓN KA: el KA respondió → lo marcamos sano y reseteamos la racha
        // de fallos, para que un "unreachable" posterior se trate como transitorio.
        if (backendRef.current === "ka") kaHealthyRef.current = true;
        kaUnreachableStreakRef.current = 0;
        return "done";
      } catch (err) {
        if ((err as Error).name === "AbortError" || stopRef.current) {
          setRows((prev) => {
            const next = [...prev];
            if (next[i].status === "running")
              next[i] = { ...next[i], status: "pending" };
            return next;
          });
          return "stopped";
        }
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
          return "stopped";
        }
        // MCP nunca es alcanzable fuera de la red corporativa (ni en Vercel): no
        // tiene sentido reintentar miles de filas → paramos de inmediato con el
        // aviso claro. OJO: gateado a backend "mcp", porque el mensaje de KA
        // ("temporarily unreachable… corporate network…") también contenía
        // "corporate network" y antes abortaba el batch por un blip transitorio.
        if (
          backendRef.current === "mcp" &&
          /MCP|corporate network|npm run dev/i.test((err as Error).message)
        ) {
          setError((err as Error).message);
          return "stopped";
        }
        // KA inalcanzable / timeout: casi siempre es un blip transitorio
        // (rate-limit o corte breve) cuando el KA ya venía respondiendo. En ese
        // caso NO abortamos: caemos a `return "error"` para que el circuit breaker
        // haga cooldown y reintente la MISMA fila. Solo paramos en seco si el KA
        // NUNCA respondió en esta ejecución y ya encadena ≥3 fallos → problema real
        // de config/red (p. ej. KA_URL apuntando a dev interno).
        if (
          backendRef.current === "ka" &&
          /unreachable|temporarily|timed out/i.test((err as Error).message)
        ) {
          kaUnreachableStreakRef.current += 1;
          if (!kaHealthyRef.current && kaUnreachableStreakRef.current >= 3) {
            setError((err as Error).message);
            return "stopped";
          }
        }
        // El hilo de esta sección pudo quedar en mal estado: lo descartamos y
        // avanzamos la rotación para que el reintento caiga en otra sección/hilo.
        const failedSection =
          BATCH_SECTIONS[rotation.current % BATCH_SECTIONS.length];
        delete sectionThreads.current[failedSection];
        rotation.current += 1;
        return "error";
      } finally {
        abortRef.current = null;
      }
    }

    // --- Pasada principal ---
    // --- Bucle principal con "circuit breaker" ---
    // Si DY empieza a devolver errores en cascada (rate-limit / cooldown), no
    // tiene sentido seguir quemando filas: pausamos de verdad y reintentamos la
    // MISMA fila tras una espera larga y creciente. Solo avanzamos cuando una
    // fila se resuelve. Una fila solo se marca "error" definitivo si agota sus
    // intentos con cooldown (evita que una pregunta "envenenada" bloquee todo).
    const CASCADE_THRESHOLD = 2; // fallos seguidos antes de pausa larga
    const MAX_ATTEMPTS_PER_ROW = 6; // intentos (con cooldown) antes de rendirse
    let i = start;

    while (i < total && !stopRef.current) {
      const st = rowsRef.current[i].status;
      // Saltamos filas ya resueltas (respondidas en el archivo de origen =
      // "skipped", o ya completadas antes = "done").
      if (st === "skipped" || st === "done") {
        setProgress(i + 1);
        i++;
        continue;
      }

      const result = await processRow(i);
      if (result === "stopped") break;

      if (result === "done") {
        consecutiveErrors = 0;
        rowAttempts.current[i] = 0;
        setProgress(i + 1);
        i++;
        // Ritmo normal entre filas.
        await interruptibleSleep(BASE_DELAY * (0.8 + Math.random() * 0.4));
        continue;
      }

      // result === "error"
      consecutiveErrors++;
      rowAttempts.current[i] = (rowAttempts.current[i] ?? 0) + 1;

      // ¿Rendirse con esta fila? Solo tras muchos intentos con cooldown.
      if (rowAttempts.current[i] >= MAX_ATTEMPTS_PER_ROW) {
        setProgress(i + 1);
        i++; // dejamos la fila en "error" y seguimos con la siguiente
        continue;
      }

      // Circuit breaker: varios fallos seguidos => DY está caído/rate-limited.
      // Pausa larga y creciente (1min, 2min, 3min… tope 5min) antes de
      // reintentar la MISMA fila. Machacar solo alarga el castigo.
      if (consecutiveErrors >= CASCADE_THRESHOLD) {
        const cooldownMs = Math.min(60000 * (consecutiveErrors - 1), 300000);
        setError(
          `DY is returning repeated errors (likely rate-limited or down). ` +
            `Pausing ${Math.round(cooldownMs / 1000)}s, then retrying row ${i + 1}. ` +
            `Press Stop to cancel.`,
        );
        await interruptibleSleep(cooldownMs);
        if (stopRef.current) break;
        setError(null);
        // No avanzamos: se reintenta la misma fila i.
      } else {
        // Fallo aislado: backoff corto y reintentar la misma fila.
        await interruptibleSleep(
          Math.min(BASE_DELAY * 2 ** consecutiveErrors, 15000) *
            (0.8 + Math.random() * 0.4),
        );
        if (stopRef.current) break;
      }
    }

    const remainingErrors = rowsRef.current.filter(
      (r) => r.status === "error",
    ).length;
    if (remainingErrors > 0 && !stopRef.current) {
      setError(
        `${remainingErrors} row(s) still failing after multiple retries — DY's service may be down. Press Start again later to retry just those rows.`,
      );
    } else if (!stopRef.current) {
      setError(null);
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
    // El export siempre es .xlsx; quitamos cualquier extensión soportada de origen.
    XLSX.writeFile(wb, fileName.replace(/\.(xlsx|xls|csv|ods)$/i, "") + "_answered.xlsx");
  }

  const doneCount = rows.filter(
    (r) => r.status === "done" || r.status === "skipped",
  ).length;

  const value: BatchContextValue = {
    rows,
    context,
    mode,
    backend,
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
    setBackend,
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
