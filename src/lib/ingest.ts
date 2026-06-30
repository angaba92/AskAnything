/**
 * Parseo e indexado de documentos para el knowledge base (RAG local).
 * Soporta: .xlsx/.xls (banco de Q&A), .pdf y .docx (documentación).
 */

import * as XLSX from "xlsx";
import mammoth from "mammoth";

export interface ParsedChunk {
  kind: "qa" | "doc";
  question?: string;
  text: string;
}

const QUESTION_KEYS = ["question", "pregunta", "questions", "q", "prompt"];
const ANSWER_KEYS = ["answer", "respuesta", "answers", "a", "response", "reply"];

/** Trocea texto largo en pasajes de ~maxChars con solape, respetando párrafos. */
function chunkText(text: string, maxChars = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];
  const paras = clean.split(/\n\n+/);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paras) {
    if ((buf + "\n\n" + p).length > maxChars && buf) {
      chunks.push(buf.trim());
      buf = buf.slice(Math.max(0, buf.length - overlap));
    }
    buf += (buf ? "\n\n" : "") + p;
    // Si un solo párrafo es enorme, lo partimos en duro.
    while (buf.length > maxChars * 1.5) {
      chunks.push(buf.slice(0, maxChars).trim());
      buf = buf.slice(maxChars - overlap);
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

function detectCol(cols: string[], keys: string[]): string | undefined {
  return cols.find((c) => keys.includes(c.trim().toLowerCase()));
}

/** Parsea un Excel como banco de pares Q&A. */
export function parseXlsx(buf: ArrayBuffer): ParsedChunk[] {
  const wb = XLSX.read(buf, { type: "array" });
  const out: ParsedChunk[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: "",
    });
    if (json.length === 0) continue;
    const cols = Object.keys(json[0]);
    const qCol = detectCol(cols, QUESTION_KEYS) ?? cols[0];
    const aCol = detectCol(cols, ANSWER_KEYS) ?? cols[1] ?? cols[0];
    for (const row of json) {
      const question = String(row[qCol] ?? "").trim();
      const answer = String(row[aCol] ?? "").trim();
      if (!question || !answer) continue;
      out.push({ kind: "qa", question, text: answer });
    }
  }
  return out;
}

/** Extrae texto de un PDF y lo trocea en pasajes. */
export async function parsePdf(buf: Buffer): Promise<ParsedChunk[]> {
  // Import dinámico: pdf-parse ejecuta código de test si se importa en top-level.
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buf);
  return chunkText(data.text).map((text) => ({ kind: "doc" as const, text }));
}

/** Extrae texto de un .docx y lo trocea en pasajes. */
export async function parseDocx(buf: Buffer): Promise<ParsedChunk[]> {
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return chunkText(value).map((text) => ({ kind: "doc" as const, text }));
}

export async function parseFile(
  name: string,
  buf: Buffer
): Promise<{ kind: string; chunks: ParsedChunk[] }> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { kind: "xlsx", chunks: parseXlsx(ab as ArrayBuffer) };
  }
  if (lower.endsWith(".pdf")) {
    return { kind: "pdf", chunks: await parsePdf(buf) };
  }
  if (lower.endsWith(".docx")) {
    return { kind: "docx", chunks: await parseDocx(buf) };
  }
  throw new Error(`Formato no soportado: ${name} (usa .xlsx, .pdf o .docx)`);
}

/** Similitud coseno entre dos vectores (asumen misma dimensión). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
