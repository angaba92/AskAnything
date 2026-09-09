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
import { MAX_CUSTOM_PROMPT_CHARS } from "@/lib/promptMapping";

export interface BatchRow {
  question: string;
  answer: string;
  review: string;
  reviewApproved: boolean;
  expert: string;
  sources: string;
  sourceRow: number;
  status: "pending" | "running" | "done" | "error" | "skipped";
}

export interface SpreadsheetColumn {
  key: string;
  index: number;
  letter: string;
  label: string;
  display: string;
}

export type BatchMode = "simple" | "detailed" | "loopio" | "custom";
// Fuentes visibles: KA remoto, biblioteca local o ambas combinadas.
// Agent/MCP permanecen aceptados únicamente por compatibilidad interna.
export type BatchBackend = "ka" | "local" | "hybrid" | "agent" | "mcp";

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
  columns: SpreadsheetColumn[];
  sheetNames: string[];
  selectedSheet: string;
  headerRow: number;
  mappingOpen: boolean;
  previewRows: string[][];
  questionCol: string;
  answerCol: string;
  reviewCol: string;
  newAnswerColumnName: string;
  newReviewColumnName: string;
  customPrompt: string;
  customPromptFileName: string;
  fetching: boolean;
  startRow: number;
  setStartRow: (v: number) => void;
  setContext: (v: string) => void;
  setMode: (v: BatchMode) => void;
  setBackend: (v: BatchBackend) => void;
  loadFile: (file: File) => void;
  loadFromUrl: (url: string) => Promise<void>;
  setSelectedSheet: (name: string) => void;
  setHeaderRow: (row: number) => void;
  setMappingOpen: (open: boolean) => void;
  setQuestionCol: (c: string) => void;
  setAnswerCol: (c: string) => void;
  setReviewCol: (c: string) => void;
  setNewAnswerColumnName: (name: string) => void;
  setNewReviewColumnName: (name: string) => void;
  loadCustomPrompt: (file: File) => Promise<void>;
  clearCustomPrompt: () => void;
  applyMapping: () => void;
  updateReview: (rowIndex: number, value: string) => void;
  approveReview: (rowIndex: number) => void;
  clearAllReviews: () => void;
  run: () => Promise<void>;
  stop: () => void;
  download: () => void;
}

const QUESTION_KEYS = [
  "question",
  "pregunta",
  "questions",
  "q",
  "prompt",
  "requirement",
  "requirements",
  "requirement text",
];
const ANSWER_KEYS = [
  "supplier response",
  "answer",
  "respuesta",
  "answers",
  "a",
  "response",
  "reply",
];
const REVIEW_KEYS = [
  "needs review",
  "review required",
  "manual review",
  "review notes",
  "confidence review",
];
const DEFAULT_ANSWER_COLUMN = "Supplier Response";
const DEFAULT_REVIEW_COLUMN = "Needs Review";

interface SpreadsheetRawRow {
  values: Record<string, string>;
  sourceRow: number;
}
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
  const [columns, setColumns] = useState<SpreadsheetColumn[]>([]);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheetState] = useState("");
  const [headerRow, setHeaderRowState] = useState(1);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [questionCol, setQuestionColState] = useState("");
  const [answerCol, setAnswerColState] = useState("");
  const [reviewCol, setReviewColState] = useState("");
  const [newAnswerColumnName, setNewAnswerColumnName] =
    useState(DEFAULT_ANSWER_COLUMN);
  const [newReviewColumnName, setNewReviewColumnName] =
    useState(DEFAULT_REVIEW_COLUMN);
  const [customPrompt, setCustomPrompt] = useState("");
  const [customPromptFileName, setCustomPromptFileName] = useState("");
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
  const workbookRef = useRef<XLSX.WorkBook | null>(null);
  const rawRef = useRef<SpreadsheetRawRow[]>([]);
  const answerColRef = useRef("");
  const reviewColRef = useRef("");
  const selectedSheetRef = useRef("");
  const headerRowRef = useRef(1);
  const startRowRef = useRef(1);
  const customPromptRef = useRef("");

  rowsRef.current = rows;
  contextRef.current = context;
  modeRef.current = mode;
  backendRef.current = backend;
  answerColRef.current = answerCol;
  reviewColRef.current = reviewCol;
  selectedSheetRef.current = selectedSheet;
  headerRowRef.current = headerRow;
  startRowRef.current = startRow;
  customPromptRef.current = customPrompt;

  function columnKey(index: number): string {
    return `c${index}`;
  }

  function normalized(value: unknown): string {
    return String(value ?? "").trim().toLowerCase();
  }

  function detectColumn(
    cols: SpreadsheetColumn[],
    keys: string[],
  ): string {
    return (
      cols.find((c) => keys.includes(normalized(c.label)))?.key ??
      cols.find((c) =>
        keys.some((key) => normalized(c.label).includes(key)),
      )?.key ??
      ""
    );
  }

  function sheetMatrix(sheetName: string): string[][] {
    const ws = workbookRef.current?.Sheets[sheetName];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      raw: false,
    }).map((row) => row.map((cell) => String(cell ?? "")));
  }

  function headerScore(row: string[]): number {
    const values = row.map(normalized);
    let score = 0;
    if (values.some((v) => QUESTION_KEYS.includes(v))) score += 6;
    if (values.some((v) => ANSWER_KEYS.includes(v))) score += 5;
    if (values.some((v) => v === "id")) score += 2;
    if (values.some((v) => v === "theme" || v === "title")) score += 1;
    return score;
  }

  function detectHeaderRow(matrix: string[][]): number {
    let bestIndex = 0;
    let bestScore = -1;
    matrix.slice(0, 30).forEach((row, index) => {
      const score = headerScore(row);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    return bestIndex + 1;
  }

  function buildColumns(matrix: string[][], oneBasedHeaderRow: number) {
    const rowIndex = Math.max(0, oneBasedHeaderRow - 1);
    const maxColumns = Math.max(
      matrix[rowIndex]?.length ?? 0,
      ...matrix.slice(rowIndex, rowIndex + 8).map((row) => row.length),
    );
    return Array.from({ length: maxColumns }, (_, index) => {
      const letter = XLSX.utils.encode_col(index);
      const label = String(matrix[rowIndex]?.[index] ?? "").trim();
      return {
        key: columnKey(index),
        index,
        letter,
        label,
        display: `${letter} — ${label || "(empty)"}`,
      };
    });
  }

  function buildRawRows(
    matrix: string[][],
    oneBasedHeaderRow: number,
    cols: SpreadsheetColumn[],
  ): SpreadsheetRawRow[] {
    return matrix.slice(oneBasedHeaderRow).map((row, offset) => ({
      sourceRow: oneBasedHeaderRow + offset,
      values: Object.fromEntries(
        cols.map((col) => [col.key, String(row[col.index] ?? "")]),
      ),
    }));
  }

  function configureSheet(sheetName: string, requestedHeaderRow?: number) {
    const matrix = sheetMatrix(sheetName);
    const nextHeaderRow = Math.max(
      1,
      Math.min(requestedHeaderRow ?? detectHeaderRow(matrix), matrix.length || 1),
    );
    const nextColumns = buildColumns(matrix, nextHeaderRow);
    const nextQuestion =
      detectColumn(nextColumns, QUESTION_KEYS) ||
      nextColumns.find((col) => col.label.trim())?.key ||
      "";
    const nextAnswer = detectColumn(nextColumns, ANSWER_KEYS);
    const nextReview = detectColumn(nextColumns, REVIEW_KEYS);

    setSelectedSheetState(sheetName);
    setHeaderRowState(nextHeaderRow);
    setColumns(nextColumns);
    setQuestionColState(nextQuestion);
    setAnswerColState(nextAnswer);
    setReviewColState(nextReview);
    setPreviewRows(matrix.slice(0, Math.min(matrix.length, nextHeaderRow + 6)));
    rawRef.current = buildRawRows(matrix, nextHeaderRow, nextColumns);
  }

  function buildRows(
    raw: SpreadsheetRawRow[],
    qCol: string,
    aCol: string,
    rCol: string,
  ): BatchRow[] {
    return raw
      .map((rawRow) => {
        const answer = aCol ? String(rawRow.values[aCol] ?? "") : "";
        const review = rCol ? String(rawRow.values[rCol] ?? "") : "";
        return {
          question: String(rawRow.values[qCol] ?? "").trim(),
          answer,
          review,
          reviewApproved: false,
          expert: "",
          sources: "",
          sourceRow: rawRow.sourceRow,
          status: (answer.trim().length > 0 ? "skipped" : "pending") as
            | "pending"
            | "skipped",
        };
      })
      .filter((r) => r.question.length > 0);
  }

  function ingestArrayBuffer(buffer: ArrayBuffer, name: string) {
    const wb = XLSX.read(buffer, { type: "array" });
    if (wb.SheetNames.length === 0) {
      setError("The workbook has no sheets.");
      return;
    }
    workbookRef.current = wb;
    setSheetNames(wb.SheetNames);
    setFileName(name);
    setRows([]);
    setProgress(0);
    setError(null);
    let bestSheet = wb.SheetNames[0];
    let bestScore = -1;
    for (const sheetName of wb.SheetNames) {
      const matrix = sheetMatrix(sheetName);
      const row = matrix[detectHeaderRow(matrix) - 1] ?? [];
      const score = headerScore(row);
      if (score > bestScore) {
        bestScore = score;
        bestSheet = sheetName;
      }
    }
    configureSheet(bestSheet);
    setMappingOpen(true);
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

  function setSelectedSheet(name: string) {
    if (!workbookRef.current?.Sheets[name]) return;
    configureSheet(name);
  }

  function setHeaderRow(row: number) {
    configureSheet(selectedSheetRef.current, row);
  }

  function setQuestionCol(c: string) {
    setQuestionColState(c);
  }

  function setAnswerCol(c: string) {
    setAnswerColState(c);
  }

  function setReviewCol(c: string) {
    setReviewColState(c);
  }

  function applyMapping() {
    if (!questionCol) {
      setError("Select the column containing the questions.");
      return;
    }
    const built = buildRows(
      rawRef.current,
      questionCol,
      answerColRef.current,
      reviewColRef.current,
    );
    if (built.length === 0) {
      setError(
        "No questions were found with this mapping. Check the sheet, header row, and question column.",
      );
      return;
    }
    setRows(built);
    const firstPending = built.findIndex((r) => r.status === "pending");
    setStartRowState(Math.max(1, (firstPending === -1 ? 0 : firstPending) + 1));
    setProgress(0);
    setError(null);
    setMappingOpen(false);
  }

  function updateReview(rowIndex: number, value: string) {
    setRows((prev) => {
      const next = [...prev];
      if (next[rowIndex]) {
        next[rowIndex] = {
          ...next[rowIndex],
          review: value,
          reviewApproved: false,
        };
      }
      return next;
    });
  }

  function approveReview(rowIndex: number) {
    setRows((prev) => {
      const next = [...prev];
      if (next[rowIndex]) {
        next[rowIndex] = { ...next[rowIndex], reviewApproved: true };
      }
      return next;
    });
  }

  function clearAllReviews() {
    setRows((prev) =>
      prev.map((row) => ({ ...row, review: "", reviewApproved: false })),
    );
  }

  async function loadCustomPrompt(file: File) {
    if (!/\.md$/i.test(file.name)) {
      setError("Custom instructions must be uploaded as a .md file.");
      return;
    }
    const text = await file.text();
    if (!text.trim()) {
      setError("The custom prompt file is empty.");
      return;
    }
    const trimmed = text.trim();
    if (trimmed.length > MAX_CUSTOM_PROMPT_CHARS) {
      setError(
        `Custom prompt is too long: ${trimmed.length.toLocaleString()} characters. ` +
          `The configured maximum is ${MAX_CUSTOM_PROMPT_CHARS.toLocaleString()}. Shorten the .md and upload it again.`,
      );
      setCustomPrompt("");
      setCustomPromptFileName("");
      return;
    }
    setCustomPrompt(trimmed);
    setCustomPromptFileName(file.name);
    setError(null);
  }

  function clearCustomPrompt() {
    setCustomPrompt("");
    setCustomPromptFileName("");
    if (modeRef.current === "custom") setMode("detailed");
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
    const BASE_DELAY =
      backendRef.current === "mcp"
        ? 30000
        : backendRef.current === "local"
          ? 100
          : 1200;
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
            confidenceReview: true,
            customPrompt:
              modeRef.current === "custom"
                ? customPromptRef.current
                : undefined,
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
          next[i] = {
            ...next[i],
            answer: data.answer,
            review: data.reviewRequired
              ? String(data.reviewReason || "Manual review required.")
              : "",
            reviewApproved: false,
            expert: data.expert,
            sources: data.tools,
            status: "done",
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
            review: "Request failed and requires manual review.",
            reviewApproved: false,
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
    const wb = workbookRef.current;
    const sheetName = selectedSheetRef.current;
    const ws = wb?.Sheets[sheetName];
    if (!wb || !ws) {
      setError("The original workbook is no longer available. Reload the file.");
      return;
    }

    const existingColumns = columns;
    const nextColumnIndex =
      existingColumns.length > 0
        ? Math.max(...existingColumns.map((col) => col.index)) + 1
        : 0;
    const answerIndex = answerColRef.current
      ? existingColumns.find((col) => col.key === answerColRef.current)?.index
      : nextColumnIndex;
    const reviewIndex = reviewColRef.current
      ? existingColumns.find((col) => col.key === reviewColRef.current)?.index
      : nextColumnIndex + (answerColRef.current ? 0 : 1);

    if (answerIndex === undefined || reviewIndex === undefined) {
      setError("The mapped output columns are invalid. Reopen column mapping.");
      return;
    }

    if (!answerColRef.current) {
      XLSX.utils.sheet_add_aoa(ws, [[newAnswerColumnName.trim() || DEFAULT_ANSWER_COLUMN]], {
        origin: { r: headerRowRef.current - 1, c: answerIndex },
      });
    }
    if (!reviewColRef.current) {
      XLSX.utils.sheet_add_aoa(ws, [[newReviewColumnName.trim() || DEFAULT_REVIEW_COLUMN]], {
        origin: { r: headerRowRef.current - 1, c: reviewIndex },
      });
    }

    for (const row of rowsRef.current) {
      XLSX.utils.sheet_add_aoa(ws, [[row.answer]], {
        origin: { r: row.sourceRow, c: answerIndex },
      });
      const exportedReview = row.reviewApproved
        ? row.review.trim()
          ? `Approved — ${row.review.trim()}`
          : "Approved"
        : row.review;
      XLSX.utils.sheet_add_aoa(ws, [[exportedReview]], {
        origin: { r: row.sourceRow, c: reviewIndex },
      });
    }

    const widths = ws["!cols"] ?? [];
    widths[answerIndex] = { ...(widths[answerIndex] ?? {}), wch: 80 };
    widths[reviewIndex] = { ...(widths[reviewIndex] ?? {}), wch: 45 };
    ws["!cols"] = widths;

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
    setBackend,
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
