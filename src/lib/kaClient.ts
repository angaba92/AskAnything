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
export const KA_URL =
  process.env.KA_URL ?? "https://dy-knowledge-assistant.use1.dynamicyield.com";

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
  "The Knowledge Assistant is temporarily unreachable. If you pointed KA_URL to the internal dev environment, it only works on the Mastercard corporate network — use the production URL or run locally. You can also switch to a backup backend (marked DO NOT USE).";

/** Log con prefijo para poder rastrear las llamadas al KA en los logs del server. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function log(level: "info" | "warn" | "error", msg: string, extra?: any) {
  const line = `[ka] ${msg}`;
  if (level === "error") console.error(line, extra ?? "");
  else if (level === "warn") console.warn(line, extra ?? "");
  else console.info(line, extra ?? "");
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
  if (!block.trim()) return out;
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
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 60000;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Encadenamos el abort externo (p. ej. el usuario cancela) con el interno.
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      const started = Date.now();
      const res = await fetch(`${KA_URL}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages }),
        cache: "no-store",
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 300).replace(/\s+/g, " ").trim();
        // 5xx → transitorio, reintentamos; 4xx → error del cliente, no.
        if (res.status >= 500 && attempt < retries) {
          log("warn", `HTTP ${res.status} (attempt ${attempt + 1}/${retries + 1}), retrying`, body);
          lastErr = new KaError(`KA responded ${res.status}: ${body}`, res.status);
          await backoff(attempt);
          continue;
        }
        throw new KaError(`KA responded ${res.status}: ${body}`, res.status);
      }

      // La respuesta es texto plano en streaming: res.text() acumula el total.
      const text = (await res.text()).trim();
      log("info", `ok in ${Date.now() - started}ms (${text.length} chars)`);
      return { text, sources: parseKaSources(text) };
    } catch (err) {
      const e = err as Error;
      if (e.name === "AbortError") {
        // Distinguimos cancelación externa (propagar) de timeout interno.
        if (opts.signal?.aborted) throw new KaError("KA request aborted.", 499);
        lastErr = new KaError("KA request timed out.", 504);
      } else {
        // Fallo de red (host inalcanzable, DNS, TLS…).
        lastErr = new KaError(KA_UNREACHABLE_MSG, 503);
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

/** Backoff corto y con jitter entre reintentos. */
function backoff(attempt: number): Promise<void> {
  const base = [500, 1500, 3000][Math.min(attempt, 2)];
  const wait = base * (0.8 + Math.random() * 0.4);
  return new Promise((r) => setTimeout(r, wait));
}
