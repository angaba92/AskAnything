"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as XLSX from "xlsx";
import { MAX_CUSTOM_PROMPT_CHARS } from "@/lib/promptMapping";
import { BatchRequestError, readBatchAnswer } from "@/lib/batchResponse";
import {
  askKaViaExtension,
  isExtensionBridgeAvailable,
  type BridgeConnection,
} from "@/lib/extensionBridge";

export interface BatchRow {
  question: string;
  answer: string;
  review: string;
  reviewApproved: boolean;
  expert: string;
  sources: string;
  sourceRow: number;
  status: "pending" | "running" | "done" | "error" | "skipped";
  /** Marca de tiempo del último Redo, para distinguir un review recalculado. */
  redoneAt?: number;
}

export interface BatchLogEntry {
  time: number;
  level: "info" | "warn" | "error";
  row?: number;
  message: string;
}

export interface SpreadsheetColumn {
  key: string;
  index: number;
  letter: string;
  label: string;
  display: string;
}

export type BatchMode = "simple" | "detailed" | "loopio" | "custom";
// El batch usa exclusivamente el Knowledge Assistant.
export type BatchBackend = "ka";

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
  /** Vuelve a pedir la respuesta de una fila aportando material adicional. */
  redoRow: (rowIndex: number, guidance: string) => Promise<void>;
  redoingRow: number | null;
  queuedRedoRows: number[];
  /** Diagnóstico: hace un PING y una petición real mínima al Knowledge Assistant. */
  testBridge: () => Promise<void>;
  bridgeTest: string | null;
  testingBridge: boolean;
  logs: BatchLogEntry[];
  clearLogs: () => void;
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
  const [rows, setRowsState] = useState<BatchRow[]>([]);
  const [context, setContext] = useState("");
  const [mode, setMode] = useState<BatchMode>("detailed");
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
  const [redoingRow, setRedoingRow] = useState<number | null>(null);
  const [queuedRedoRows, setQueuedRedoRows] = useState<number[]>([]);
  const [bridgeTest, setBridgeTest] = useState<string | null>(null);
  const [testingBridge, setTestingBridge] = useState(false);
  const [logs, setLogs] = useState<BatchLogEntry[]>([]);

  /** Añade una entrada al log, acotado para no crecer sin límite. */
  const log = useCallback(
    (level: BatchLogEntry["level"], message: string, row?: number) => {
      setLogs((prev) =>
        [...prev, { time: Date.now(), level, message, row }].slice(-800),
      );
    },
    [],
  );

  function clearLogs() {
    setLogs([]);
  }

  function logBridge(connection: BridgeConnection) {
    log("info", `Bridge selected: ${connection.extensionId || "legacy"} · version=${connection.extensionVersion || "unknown"} · transport=${connection.transport || "callback (update extension)"}`);
  }
  const redoQueue = useRef<Array<{ index: number; guidance: string }>>([]);
  const runningRef = useRef(false);
  const standaloneRef = useRef(false);
  const redoActiveRef = useRef<number | null>(null);
  const stopRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const rowAttempts = useRef<Record<number, number>>({});
  const rowLastErrors = useRef<Record<number, string>>({});
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
  answerColRef.current = answerCol;
  reviewColRef.current = reviewCol;
  selectedSheetRef.current = selectedSheet;
  headerRowRef.current = headerRow;
  startRowRef.current = startRow;
  customPromptRef.current = customPrompt;

  function setRows(update: SetStateAction<BatchRow[]>) {
    const next = typeof update === "function" ? update(rowsRef.current) : update;
    rowsRef.current = next;
    setRowsState(next);
  }

  function busy() {
    return runningRef.current || standaloneRef.current;
  }

  function requireIdle() {
    if (!busy()) return true;
    setError("Stop the active batch, Redo, or bridge test before changing the workbook.");
    return false;
  }

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
    return raw.flatMap((rawRow) => {
      const question = String(rawRow.values[qCol] ?? "").trim();
      if (!question || looksLikeSectionHeading(question)) return [];

      const answer = aCol ? String(rawRow.values[aCol] ?? "") : "";
      const review = rCol ? String(rawRow.values[rCol] ?? "") : "";
      return [
        {
          question,
          answer,
          review,
          reviewApproved: false,
          expert: "",
          sources: "",
          sourceRow: rawRow.sourceRow,
          status: (answer.trim().length > 0 ? "skipped" : "pending") as
            | "pending"
            | "skipped",
        },
      ];
    });
  }

  function looksLikeSectionHeading(value: string): boolean {
    const text = value.replace(/\s+/g, " ").trim();
    if (text.length > 100 || /[?.:;]/.test(text)) return false;

    const words = text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
    if (words.length === 0 || words.length > 10) return false;
    if (
      /\b(?:is|are|do|does|can|could|will|would|must|should|describe|explain|provide|support|ability|what|how|when|where|which|why)\b/i.test(
        text,
      )
    ) {
      return false;
    }

    const significant = words.filter((word) => word.length > 2);
    const titleCase = significant.filter(
      (word) => /^[A-Z][a-z]/.test(word) || /^[A-Z]{2,}$/.test(word),
    );
    return (
      significant.length >= 2 &&
      titleCase.length / significant.length >= 0.8
    );
  }

  function ingestArrayBuffer(buffer: ArrayBuffer, name: string) {
    if (!requireIdle()) return;
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
    if (!requireIdle()) return;
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
    if (!requireIdle()) return;
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
    if (!requireIdle()) return;
    if (!workbookRef.current?.Sheets[name]) return;
    configureSheet(name);
  }

  function setHeaderRow(row: number) {
    if (!requireIdle()) return;
    configureSheet(selectedSheetRef.current, row);
  }

  function setQuestionCol(c: string) {
    if (!requireIdle()) return;
    setQuestionColState(c);
  }

  function setAnswerCol(c: string) {
    if (!requireIdle()) return;
    setAnswerColState(c);
  }

  function setReviewCol(c: string) {
    if (!requireIdle()) return;
    setReviewColState(c);
  }

  function applyMapping() {
    if (!requireIdle()) return;
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

  /**
   * Ejecuta el Redo de UNA fila aportando material adicional (link, cita o
   * notas) como fuente autorizada. Siempre una petición a KA a la vez.
   */
  async function executeRedo(rowIndex: number, guidance: string) {
    const row = rowsRef.current[rowIndex];
    const extra = guidance.trim();
    if (!row || !extra) return;

    setRedoingRow(rowIndex);
    redoActiveRef.current = rowIndex;
    const controller = new AbortController();
    abortRef.current = controller;
    const started = Date.now();
    const requestMode = modeRef.current;
    const requestPrompt = requestMode === "custom" ? customPromptRef.current : undefined;
    const timeout = setTimeout(() => controller.abort(), 220000);
    setError(null);
    log("info", `Redo requested with extra source material.`, rowIndex + 1);
    try {
      const enrichedContext = [
        contextRef.current,
        `ADDITIONAL SOURCE MATERIAL PROVIDED BY THE RFP OWNER (treat as authoritative and use it to improve the answer):\n${extra}`,
      ]
        .filter((part) => part.trim())
        .join("\n\n");

      const useBridge = !["localhost", "127.0.0.1"].includes(
        window.location.hostname,
      );
      let bridged: string | undefined;
      if (useBridge) {
        if (!(await isExtensionBridgeAvailable())) {
          throw new Error(
            "Corporate bridge not connected. Install/reload the AskAnything extension, connect to the VPN, and retry.",
          );
        }
        bridged = await askKaViaExtension(row.question, {
          mode: requestMode,
          context: enrichedContext,
          confidenceReview: true,
          signal: controller.signal,
          onBridgeSelected: logBridge,
          customPrompt: requestPrompt,
        });
      }

      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: row.question,
          context: enrichedContext,
          mode: requestMode,
          backend: "ka",
          confidenceReview: true,
          customPrompt: requestPrompt,
          localKaResponse: bridged,
        }),
        signal: controller.signal,
      });
      const data = await readBatchAnswer(response);
      if (stopRef.current || controller.signal.aborted) return;

      setRows((prev) => {
        const next = [...prev];
        next[rowIndex] = {
          ...next[rowIndex],
          answer: data.answer,
          review: data.reviewRequired
            ? String(data.reviewReason || "Manual review required.")
            : "",
          reviewApproved: false,
          expert: data.expert,
          sources: data.tools,
          status: "done",
          redoneAt: Date.now(),
        };
        return next;
      });
      log("info", `Redo completed in ${((Date.now() - started) / 1000).toFixed(1)}s; answer and review updated.`, rowIndex + 1);
    } catch (err) {
      if (controller.signal.aborted || stopRef.current) {
        log("info", "Redo cancelled; previous answer and review preserved.", rowIndex + 1);
        return;
      }
      setError(`Redo failed on row ${rowIndex + 1}: ${(err as Error).message}`);
      log("error", `Redo failed: ${(err as Error).message}`, rowIndex + 1);
    } finally {
      clearTimeout(timeout);
      abortRef.current = null;
      redoActiveRef.current = null;
      setRedoingRow(null);
    }
  }

  /**
   * Encola el Redo cuando el batch está en marcha (se atiende con prioridad
   * entre filas) o lo ejecuta al momento cuando el batch está parado.
   */
  async function redoRow(rowIndex: number, guidance: string) {
    const extra = guidance.trim();
    if (!rowsRef.current[rowIndex] || !extra) {
      setError("Select a valid row and provide notes for Redo.");
      return;
    }
    if (stopRef.current && busy()) {
      setError("Wait for the active request to stop before requesting Redo.");
      return;
    }
    if (redoActiveRef.current === rowIndex || redoQueue.current.some((job) => job.index === rowIndex)) {
      setError("This row already has an active or queued Redo.");
      return;
    }

    if (runningRef.current || standaloneRef.current && redoActiveRef.current !== null) {
      redoQueue.current.push({ index: rowIndex, guidance: extra });
      setQueuedRedoRows((prev) =>
        prev.includes(rowIndex) ? prev : [...prev, rowIndex],
      );
      log("info", "Redo queued; it will run after the current request.", rowIndex + 1);
      return;
    }
    if (standaloneRef.current) {
      setError("Wait for the bridge test before requesting Redo.");
      return;
    }
    standaloneRef.current = true;
    stopRef.current = false;
    try {
      await executeRedo(rowIndex, extra);
      await drainRedoQueue();
    } finally {
      standaloneRef.current = false;
      setStopping(false);
    }
  }

  /** Vacía la cola de Redos antes de continuar con la siguiente pregunta. */
  async function drainRedoQueue() {
    while (redoQueue.current.length > 0 && !stopRef.current) {
      const job = redoQueue.current.shift();
      if (!job) break;
      await executeRedo(job.index, job.guidance);
      setQueuedRedoRows((prev) => prev.filter((index) => index !== job.index));
    }
  }

  /**
   * Diagnóstico del puente: comprueba el service worker y hace una petición real
   * y mínima a KA, mostrando el error exacto en vez de dejar filas colgadas.
   */
  async function testBridge() {
    if (busy()) {
      setError("Wait for the active request before testing the bridge.");
      return;
    }
    standaloneRef.current = true;
    stopRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;
    setTestingBridge(true);
    setBridgeTest("Testing…");
    try {
      const host = window.location.hostname;
      if (["localhost", "127.0.0.1"].includes(host)) {
        setBridgeTest("Running on localhost: the bridge is not used here.");
        return;
      }

      const started = Date.now();
      const available = await isExtensionBridgeAvailable();
      if (!available) {
        setBridgeTest(
          "PING failed: the extension is not loaded in this window. " +
            "In incognito, open chrome://extensions and enable 'Allow in Incognito', then reload the extension and this tab.",
        );
        return;
      }

      const text = await askKaViaExtension(
        "Reply with the single word OK.",
        { mode: "custom", customPrompt: "Reply only with OK.", confidenceReview: false, signal: controller.signal, onBridgeSelected: logBridge },
      );
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      setBridgeTest(
        `Bridge OK in ${seconds}s. Knowledge Assistant replied: ` +
          `${text.replace(/\s+/g, " ").trim().slice(0, 120)}`,
      );
      log("info", `Bridge test OK in ${seconds}s.`);
    } catch (err) {
      setBridgeTest(`Bridge failed: ${(err as Error).message}`);
      log("error", `Bridge test failed: ${(err as Error).message}`);
    } finally {
      standaloneRef.current = false;
      abortRef.current = null;
      setStopping(false);
      setTestingBridge(false);
    }
  }

  async function run() {
    if (rowsRef.current.length === 0) return;
    if (busy()) {
      setError("Wait for the active request before starting the batch.");
      return;
    }
    runningRef.current = true;
    try {
    setRunning(true);
    setStopping(false);
    setError(null);
    stopRef.current = false;
    rowAttempts.current = {};
    rowLastErrors.current = {};
    sectionThreads.current = {};
    rotation.current = 0;
    kaHealthyRef.current = false;
    kaUnreachableStreakRef.current = 0;

    const useCorporateBridge = !["localhost", "127.0.0.1"].includes(
      window.location.hostname,
    );
    log(
      "info",
      `Run started · style=${modeRef.current} · ${useCorporateBridge ? "via corporate bridge" : "direct (localhost)"}`,
    );
    if (useCorporateBridge && !(await isExtensionBridgeAvailable())) {
      setError(
        "Corporate bridge not connected. Install/reload the AskAnything Chrome or Edge extension, connect to the VPN, and retry.",
      );
      log("error", "Corporate bridge not connected. Run aborted.");
      setRunning(false);
      runningRef.current = false;
      setStopping(false);
      return;
    }

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

    // Pausa base entre filas (ms) + ralentización adaptativa: si KA empieza a
    // fallar, aumentamos la espera para no saturarlo; al ir bien, la bajamos.
    const BASE_DELAY = 1200;
    let consecutiveErrors = 0;

    // Procesa una fila. Devuelve "done" | "error" | "stopped".
    async function processRow(i: number): Promise<"done" | "error" | "failed" | "stopped"> {
      setRows((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], status: "running" };
        return next;
      });

      const controller = new AbortController();
      let generationReceived = false;
      const timeout = setTimeout(() => {
        setError("The request exceeded 220 seconds. Batch paused; resume manually.");
        stopRef.current = true;
        controller.abort();
      }, 220000);
      try {
        const rowStarted = Date.now();
        abortRef.current = controller;
        const question = rowsRef.current[i].question;
        const requestMode = modeRef.current;
        const requestContext = contextRef.current;
        const requestPrompt = requestMode === "custom" ? customPromptRef.current : undefined;
        log("info", `Asking: ${question.slice(0, 90)}`, i + 1);
        let localKaResponse: string | undefined;
        if (useCorporateBridge) {
          const bridgeStarted = Date.now();
          localKaResponse = await askKaViaExtension(question, {
            mode: requestMode,
            context: requestContext || undefined,
            confidenceReview: true,
            customPrompt: requestPrompt,
            signal: controller.signal,
            onBridgeSelected: logBridge,
          });
          generationReceived = true;
          log(
            "info",
            `Bridge replied in ${((Date.now() - bridgeStarted) / 1000).toFixed(1)}s (${localKaResponse.length} chars)`,
            i + 1,
          );
        }
        // Sección (y por tanto hilo) de esta pregunta. Rotamos en cada intento.
        const section = BATCH_SECTIONS[rotation.current % BATCH_SECTIONS.length];
        const askApi = async (bridgedResponse?: string) => {
          const response = await fetch("/api/ask", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              question,
              context: requestContext,
              mode: requestMode,
              backend: "ka",
              sectionId: section,
              threadId: sectionThreads.current[section] ?? undefined,
              confidenceReview: true,
              customPrompt: requestPrompt,
              localKaResponse: bridgedResponse,
            }),
            signal: controller.signal,
          });
          return readBatchAnswer(response);
        };

        // Una sola llamada por fila: KA debe dar la mejor respuesta a la primera
        // y la normalización conserva su contenido íntegro.
        const data = await askApi(localKaResponse);
        if (!String(data.answer ?? "").trim()) {
          throw new Error(
            "Knowledge Assistant returned no substantive answer.",
          );
        }
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
        kaHealthyRef.current = true;
        kaUnreachableStreakRef.current = 0;
        log(
          data.reviewRequired ? "warn" : "info",
          `Done in ${((Date.now() - rowStarted) / 1000).toFixed(1)}s` +
            (data.reviewRequired
              ? ` · needs review: ${String(data.reviewReason || "").slice(0, 120)}`
              : ""),
          i + 1,
        );
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
        rowLastErrors.current[i] = (err as Error).message;
        log("error", `Failed: ${(err as Error).message}`, i + 1);
        setRows((prev) => {
          const next = [...prev];
          next[i] = {
            ...next[i],
            answer: "",
            review: (err as Error).message,
            reviewApproved: false,
            status: "pending",
          };
          return next;
        });
        if (err instanceof BatchRequestError && err.status === 422) {
          setRows((prev) => prev.map((row, index) => index === i ? { ...row, status: "error" } : row));
          return "failed";
        }
        // A closed channel/timeout has an unknown outcome. Never submit a
        // duplicate generation while the original may still be running.
        if (generationReceived ||
            err instanceof BatchRequestError && err.status >= 400 && err.status < 500 && err.status !== 429 ||
            /channel closed|message channel|timed out|timeout|authentication|bridge.*(?:not connected|disconnected|failed)|extension context|runtime|background worker|without JSON/i.test((err as Error).message)) {
          setError(`${(err as Error).message} Batch paused; completed rows are preserved.`);
          stopRef.current = true;
          return "stopped";
        }
        if (/sesi[oó]n|session|cookie|xsrf|caduc/i.test((err as Error).message)) {
          setError((err as Error).message);
          stopRef.current = true;
          return "stopped";
        }
        // KA inalcanzable / timeout suele ser un fallo transitorio de DNS, red o
        // rate limit. Nunca detenemos todo el batch: dejamos que el circuito haga
        // cooldown y vuelva a intentar esta misma fila.
        if (/unreachable|temporarily|timed out/i.test((err as Error).message)) {
          kaUnreachableStreakRef.current += 1;
        }
        // El hilo de esta sección pudo quedar en mal estado: lo descartamos y
        // avanzamos la rotación para que el reintento caiga en otra sección/hilo.
        const failedSection =
          BATCH_SECTIONS[rotation.current % BATCH_SECTIONS.length];
        delete sectionThreads.current[failedSection];
        rotation.current += 1;
        return "error";
      } finally {
        clearTimeout(timeout);
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
    const MAX_ATTEMPTS_PER_ROW = 2;
    let i = start;

    while (i < total && !stopRef.current) {
      // Prioridad: los Redo encolados se atienden antes de la siguiente fila.
      await drainRedoQueue();
      if (stopRef.current) break;

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
      if (result === "failed") {
        consecutiveErrors = 0;
        setProgress(i + 1);
        i++;
        continue;
      }

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
        const failedIndex = i;
        const finalError =
          rowLastErrors.current[i] ??
          "The Knowledge Assistant request failed after multiple retries.";
        setRows((prev) => {
          const next = [...prev];
          next[failedIndex] = {
            ...next[failedIndex],
            answer: "",
            review: finalError,
            reviewApproved: false,
            status: "error",
          };
          return next;
        });
        setProgress(i + 1);
        i++; // dejamos la fila en "error" y seguimos con la siguiente
        continue;
      }

      // Circuit breaker: varios fallos seguidos => KA está caído/rate-limited.
      // Pausa creciente (15s, 30s, 60s) antes de
      // reintentar la MISMA fila. Machacar solo alarga el castigo.
      if (consecutiveErrors >= CASCADE_THRESHOLD) {
        const cooldownMs = Math.min(
          15000 * 2 ** (consecutiveErrors - CASCADE_THRESHOLD),
          60000,
        );
        setError(
          `Knowledge Assistant is returning repeated errors. ` +
            `Pausing ${Math.round(cooldownMs / 1000)}s, then retrying row ${i + 1}. ` +
            `Last error: ${rowLastErrors.current[i] ?? "unknown"}. ` +
            `Press Stop to cancel.`,
        );
        log(
          "warn",
          `Cooldown ${Math.round(cooldownMs / 1000)}s after ${consecutiveErrors} consecutive errors.`,
          i + 1,
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

    // Al terminar el recorrido atendemos los Redo que quedaran encolados.
    await drainRedoQueue();

    const remainingErrors = rowsRef.current.filter(
      (r) => r.status === "error",
    ).length;
    if (remainingErrors > 0 && !stopRef.current) {
      setError(
        `${remainingErrors} row(s) need attention. Use Redo with notes, or press Start to retry incomplete rows.`,
      );
    } else if (!stopRef.current) {
      setError(null);
    }

    setRunning(false);
    runningRef.current = false;
    setStopping(false);
    log(
      "info",
      stopRef.current ? "Run stopped or paused; completed rows preserved." : "Run finished.",
    );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Batch paused: ${message}`);
      log("error", `Batch paused: ${message}`);
      redoQueue.current = [];
      setQueuedRedoRows([]);
    } finally {
      runningRef.current = false;
      setRunning(false);
      setStopping(false);
    }
  }

  function stop() {
    stopRef.current = true;
    setStopping(true);
    abortRef.current?.abort();
    redoQueue.current = [];
    setQueuedRedoRows([]);
    log("info", "Stop requested; queued Redos cancelled.");
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
    redoRow,
    redoingRow,
    queuedRedoRows,
    testBridge,
    bridgeTest,
    testingBridge,
    logs,
    clearLogs,
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
