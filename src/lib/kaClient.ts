import { SOURCE_LABEL } from "./multilingual";

/**
 * Cliente server-side para el "DY Knowledge Assistant" — la NUEVA plataforma por
 * defecto de AskAnything.
 *
 * Es una app oficial de Dynamic Yield (Next.js sobre AWS Bedrock · Claude) que
 * responde preguntas de producto/seguridad citando fuentes, grounded en dy.dev,
 * el Help Center y la base interna GURU (respuestas RFP/RFI ya aprobadas).
 *
 * MIGRACIÓN: sustituye al backend "Agent" (threaded, con ventana de 2h) y al MCP
 * como camino de ejecución por defecto. Ventajas: es stateless (cada pregunta es
 * independiente), rápido (~2s) y — a diferencia del MCP — su URL de PRODUCCIÓN es
 * pública (alcanzable también desde Vercel).
 *
 * Contrato del endpoint (idéntico al que usa la propia UI del KA):
 *   POST {KA_URL}/api/chat
 *   body: { messages: [{ role: "user"|"assistant", content: string }] }
 *   resp: texto plano en streaming (NO SSE) → acumulamos y devolvemos el total.
 *
 * NOTA: el KA no expone un endpoint "bulk" server-side; su pestaña "Bulk CSV"
 * hace un bucle de /api/chat en cliente. Nuestro batch replica ese patrón
 * (una llamada por fila), por eso este cliente es la única superficie de red.
 */

/** Base URL del KA. Por defecto la de PRODUCCIÓN (pública). Configurable por env
 * para poder apuntar al entorno dev (`*.dev.dydy.io`) o a un futuro dominio. */
export const KA_URL = (
  process.env.KA_URL ?? "https://dy-knowledge-assistant.use1.dynamicyield.com"
).trim().replace(/\/+$/, "");

const KA_CORPORATE_URL = (
  process.env.KA_FALLBACK_URL ??
  "https://dy-knowledge-assistant.use1.dev.dydy.io"
).trim().replace(/\/+$/, "");

const KA_ENDPOINTS = Array.from(new Set([KA_URL, KA_CORPORATE_URL]));

export interface KaSource {
  title?: string;
  uri?: string;
  reasoning?: string;
}

export interface KaChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface KaResult {
  /** Texto completo devuelto por el KA (markdown). */
  text: string;
  /** Fuentes parseadas del bloque "## Sources" (si lo hay). */
  sources: KaSource[];
}

export class KaError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "KaError";
    this.status = status;
  }
}

/** Mensaje claro si el KA no es alcanzable (fallback defensivo). Con la URL de
 * producción esto no debería ocurrir ni siquiera en Vercel, pero lo dejamos por
 * si se apunta al entorno dev (interno) o hay un corte de red. */
export const KA_UNREACHABLE_MSG =
  "The Knowledge Assistant is temporarily unreachable. The request will be retried automatically.";

/** Log con prefijo para poder rastrear las llamadas al KA en los logs del server. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function log(level: "info" | "warn" | "error", msg: string, extra?: any) {
  const line = `[ka] ${msg}`;
  if (level === "error") console.error(line, extra ?? "");
  else if (level === "warn") console.warn(line, extra ?? "");
  else console.info(line, extra ?? "");
}

/** Página de error HTML (gateway/proxy) en lugar de la respuesta en texto del KA. */
export function isKaErrorPage(text: string): boolean {
  return /^\s*(?:<!doctype html|<html[\s>])/i.test(text ?? "") ||
    /<title>\s*\d{3}\s+[^<]*<\/title>/i.test((text ?? "").slice(0, 500));
}

/** Token que el KA devuelve (según su system prompt) cuando no puede responder. */
export const KA_NO_ANSWER = "NO_ANSWER";

export function isKaNoAnswer(text: string): boolean {
  const value = text ?? "";
  if (/^\s*[`*_]*NO_ANSWER[`*_.]*\s*$/.test(value)) return true;
  // Loopio frame: BEGIN_CLIENT_ANSWER NO_ANSWER END_CLIENT_ANSWER (with research
  // narration before it and CONFIDENCE_REVIEW after it).
  const frame = value.match(/BEGIN_CLIENT_ANSWER\s*([\s\S]*?)\s*END_CLIENT_ANSWER/i);
  return Boolean(frame && /^[`*_]*NO_ANSWER[`*_.]*$/.test(frame[1].trim()));
}

const SOURCE_LINE = new RegExp(`^\\s*(?:[-•*]\\s*)?(?:\\*\\*)?${SOURCE_LABEL}(?:\\*\\*)?\\s*:\\s*(.+)$`, "iu");

/** Divide "[T](U), T2 (U2), U3" en entradas {title, uri}. */
function splitInlineSources(list: string): KaSource[] {
  const out: KaSource[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|([^,;()[\]]*?)\s*\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s,;)]+)/g;
  for (const m of list.matchAll(re)) {
    const uri = (m[2] ?? m[4] ?? m[5] ?? "").replace(/[.,;]+$/, "");
    if (!uri) continue;
    const title = (m[1] ?? m[3] ?? "").replace(/^[\s,;]+|[\s,;]+$/g, "").trim();
    out.push(title ? { title, uri } : { uri });
  }
  return out;
}

/** Líneas de metadatos que pueden seguir a la frase de fuentes (Loopio/confianza). */
const TRAILING_METADATA =
  /^\s*(?:[*_`]*)?(?:END_CLIENT_ANSWER|BEGIN_CLIENT_ANSWER|CONFIDENCE[\s_-]*REVIEW\b|_?confidence\s*:)/i;

/**
 * Localiza el bloque de líneas "Source(s): …" (con URL) que cierra la respuesta,
 * aunque vaya seguido de marcadores como END_CLIENT_ANSWER o CONFIDENCE_REVIEW.
 */
function locateSourceLines(text: string): { lines: string[]; first: number; last: number; sources: KaSource[] } {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  let end = lines.length - 1;
  while (end >= 0 && (!lines[end].trim() || TRAILING_METADATA.test(lines[end]))) end--;
  const sources: KaSource[] = [];
  let first = end + 1;
  for (let i = end; i >= 0; i--) {
    const m = lines[i].match(SOURCE_LINE);
    if (!m || !/https?:\/\//.test(m[1])) break;
    sources.unshift(...splitInlineSources(m[1]));
    first = i;
  }
  const seen = new Set<string>();
  return {
    lines,
    first,
    last: end,
    sources: sources.filter((s) => (s.uri && !seen.has(s.uri) ? (seen.add(s.uri), true) : false)),
  };
}

function trailingSourceLines(text: string): { body: string; sources: KaSource[] } {
  const found = locateSourceLines(text);
  return { body: found.lines.slice(0, found.first).join("\n").trimEnd(), sources: found.sources };
}

/**
 * Adaptador de compatibilidad. El KA cambió su system prompt: ya no emite el
 * bloque "## Sources" sino una frase final "Source: [Title](URL), [T2](U2)" (o
 * "Source: Title (URL)"). La reescribimos, en su sitio, a la línea canónica de
 * AskAnything "Sources: URL1; URL2", la misma que ya producían los demás caminos
 * y que espera la normalización/exportación. Los marcadores posteriores
 * (END_CLIENT_ANSWER, CONFIDENCE_REVIEW) se conservan. El bloque "## Sources"
 * antiguo se deja intacto.
 */
export function normalizeKaSourceFormat(text: string): string {
  const raw = (text ?? "").replace(/\r\n/g, "\n");
  if (/^\s*#{1,6}\s*Sources?\s*$/im.test(raw)) return raw;
  const found = locateSourceLines(raw);
  if (found.sources.length === 0) return raw;
  const before = found.lines.slice(0, found.first).join("\n").trimEnd();
  const after = found.lines.slice(found.last + 1).join("\n").replace(/^\n+/, "");
  const line = `Sources: ${found.sources.map((s) => s.uri).join("; ")}`;
  return [before, line, after].filter((part) => part.trim()).join("\n\n");
}

/**
 * Parsea el bloque "## Sources" del markdown del KA. Cada línea tiene la forma:
 *   - [Page Title](https://url) — ≤12-word reason
 * Devuelve las fuentes estructuradas (para la columna "sources" del batch).
 */
export function parseKaSources(markdown: string): KaSource[] {
  const out: KaSource[] = [];
  const m = markdown.match(/##\s*Sources\s*\n([\s\S]*?)(?:\n##\s|\s*$)/i);
  const block = m ? m[1] : "";
  // Formato nuevo: frase final "Source: [Title](URL), …".
  if (!block.trim()) return trailingSourceLines(markdown).sources;
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // - [Title](URL) — reason   |   or a bare "- URL"
    const linked = line.match(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)\s*(?:[—–-]\s*(.*))?/);
    if (linked) {
      out.push({ title: linked[1]?.trim(), uri: linked[2], reasoning: linked[3]?.trim() });
      continue;
    }
    const bare = line.match(/(https?:\/\/[^\s)]+)/);
    if (bare) out.push({ uri: bare[1] });
  }
  return out;
}

/**
 * Llama a {KA_URL}/api/chat con el historial de mensajes y devuelve el texto
 * completo (acumulando el stream) + las fuentes parseadas.
 *
 * Reintenta ante fallos transitorios (5xx / red) con backoff corto — el KA es
 * rápido, así que no penaliza. Un timeout evita colgar la respuesta.
 */
export async function kaChat(
  messages: KaChatMessage[],
  opts: { timeoutMs?: number; retries?: number; signal?: AbortSignal } = {}
): Promise<KaResult> {
  const retries = opts.retries ?? 4;
  const timeoutMs = opts.timeoutMs ?? 60000;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const endpoint = KA_ENDPOINTS[attempt % KA_ENDPOINTS.length];
    const host = new URL(endpoint).host;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Encadenamos el abort externo (p. ej. el usuario cancela) con el interno.
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      const started = Date.now();
      const res = await fetch(`${endpoint}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages }),
        cache: "no-store",
        signal: controller.signal,
      });

      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new KaError(`Knowledge Assistant responded HTTP ${res.status}.`, res.status);
      }

      // La respuesta es texto plano en streaming: res.text() acumula el total.
      const original = (await res.text()).trim();
      if (isKaErrorPage(original)) {
        throw new KaError("Knowledge Assistant returned an HTML error page instead of an answer.", 502);
      }
      const text = normalizeKaSourceFormat(original);
      log(
        "info",
        `ok via ${host} in ${Date.now() - started}ms (${text.length} chars)`,
      );
      return { text, sources: parseKaSources(original) };
    } catch (err) {
      const e = err as Error;
      if (e instanceof KaError) {
        lastErr = e;
        log(resumableStatus(e.status) ? "warn" : "error", "HTTP request failed", {
          host,
          status: e.status,
          attempt: attempt + 1,
          attempts: retries + 1,
        });
        if (resumableStatus(e.status) && attempt < retries) {
          await backoff(attempt);
          continue;
        }
        throw e;
      }

      if (e.name === "AbortError") {
        // Distinguimos cancelación externa (propagar) de timeout interno.
        if (opts.signal?.aborted) throw new KaError("KA request aborted.", 499);
        lastErr = new KaError("KA request timed out.", 504);
        log("warn", "request timed out", {
          host,
          timeoutMs,
          attempt: attempt + 1,
          attempts: retries + 1,
        });
      } else {
        const cause = networkCause(e);
        log("error", "network request failed", {
          host,
          error: e.name,
          code: cause.code,
          cause: cause.name,
          causeMessage: cause.message,
          attempt: attempt + 1,
          attempts: retries + 1,
        });
        lastErr = new KaError(
          `${KA_UNREACHABLE_MSG} Diagnostic: host=${host}, code=${cause.code ?? "unknown"}.`,
          503,
        );
      }
      if (attempt < retries) {
        log("warn", `${lastErr.message} (attempt ${attempt + 1}/${retries + 1}), retrying`);
        await backoff(attempt);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  log("error", `failed after ${retries + 1} attempts`, lastErr?.message);
  throw lastErr ?? new KaError(KA_UNREACHABLE_MSG, 503);
}

function resumableStatus(status?: number): boolean {
  return status === 429 || (status !== undefined && status >= 500);
}

function networkCause(error: Error): {
  code?: string;
  name?: string;
  message?: string;
} {
  const cause = error.cause;
  if (!cause || typeof cause !== "object") return {};

  const value = cause as Record<string, unknown>;
  return {
    code: typeof value.code === "string" ? value.code : undefined,
    name: typeof value.name === "string" ? value.name : undefined,
    message:
      typeof value.message === "string"
        ? value.message.slice(0, 200)
        : undefined,
  };
}

/** Backoff corto y con jitter entre reintentos. */
function backoff(attempt: number): Promise<void> {
  const base = [500, 1500, 3000][Math.min(attempt, 2)];
  const wait = base * (0.8 + Math.random() * 0.4);
  return new Promise((r) => setTimeout(r, wait));
}
