/**
 * Cliente server-side para el servidor MCP de Dynamic Yield
 * (`expos-mcp-tools`). Es un backend ALTERNATIVO al agente "Experience OS
 * Agents": a diferencia de éste, es stateless (cada llamada es independiente,
 * sin thread singleton, sin ventana de ~2h, sin colisiones multi-usuario) y
 * devuelve las fuentes de forma estructurada.
 *
 * Transporte: JSON-RPC 2.0 sobre HTTP. La respuesta llega como Server-Sent
 * Events (líneas `event:` / `data:`), así que parseamos la última línea `data:`.
 */

const MCP_URL =
  process.env.MCP_URL ??
  "https://expos-mcp-tools.use1.dynamicyield.com/mcp";

export interface McpSource {
  title?: string;
  uri?: string;
  reasoning?: string;
}

export interface McpToolResult {
  text: string;
  sources: McpSource[];
  isError: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any;
}

export class McpError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "McpError";
    this.status = status;
  }
}

/** Mensaje claro cuando el host MCP no es alcanzable (p. ej. desde Vercel). */
export const MCP_UNREACHABLE_MSG =
  "The Knowledge (MCP) backend is only reachable from the Mastercard corporate network, so it can't be used on the hosted (Vercel) app. Run AskAnything locally (npm run dev) on your corporate machine to use it, or switch to the Agent backend.";

/** ¿Estamos en un entorno de nube pública (Vercel) que NO puede alcanzar el
 * host interno de Mastercard? Si es así, cortamos de inmediato con un mensaje
 * claro en vez de esperar a que el fetch falle por timeout. */
export function isMcpReachableEnv(): boolean {
  return !process.env.VERCEL;
}

let rpcId = 1;

/** Parsea una respuesta MCP: SSE (`data: {...}`) o JSON plano. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseMcpPayload(raw: string): any {
  const dataLines = raw
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  const payload = dataLines.length ? dataLines[dataLines.length - 1] : raw.trim();
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/** ¿El resultado es un error transitorio "in-band" (HTTP 200 con texto de error)? */
function isTransientToolText(text: string): boolean {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return true;
  return (
    t === "failed to execute tool" ||
    /^(something went wrong|try again|temporarily unavailable|internal error|timeout)/.test(t)
  );
}

/** Llama a una tool del servidor MCP y normaliza el resultado. Reintenta los
 * fallos transitorios de la tool (p. ej. "Failed to execute tool") con backoff. */
export async function mcpCallTool(
  name: string,
  args: Record<string, unknown>,
  opts: { timeoutMs?: number; retries?: number } = {}
): Promise<McpToolResult> {
  const retries = opts.retries ?? 2;
  // El tool es lento (~25s) y rate-limited: tras un par de llamadas devuelve
  // "Failed to execute tool". Reintentamos con esperas para darle margen de
  // recuperación, pero acotadas para no colgar la respuesta demasiado.
  const backoff = [8000, 20000];
  let lastResult: McpToolResult | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await mcpCallToolOnce(name, args, opts);
    // Éxito real: texto útil y sin flag de error.
    if (!result.isError && result.text && !isTransientToolText(result.text)) {
      return result;
    }
    lastResult = result;
    if (attempt < retries) {
      const base = backoff[Math.min(attempt, backoff.length - 1)];
      const wait = base * (0.8 + Math.random() * 0.4);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  // Se agotaron los reintentos: devolvemos lo último (el caller decide).
  if (lastResult) {
    if (isTransientToolText(lastResult.text)) {
      throw new McpError(
        `MCP tool failed transiently after ${retries + 1} attempts: ${lastResult.text || "(empty)"}`,
        502
      );
    }
    return lastResult;
  }
  throw new McpError("MCP returned no result.");
}

/** Una sola llamada JSON-RPC a la tool (sin reintentos). */
async function mcpCallToolOnce(
  name: string,
  args: Record<string, unknown>,
  opts: { timeoutMs?: number } = {}
): Promise<McpToolResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120000);

  let res: Response;
  try {
    res = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId++,
        method: "tools/call",
        params: { name, arguments: args },
      }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === "AbortError") {
      throw new McpError("MCP request timed out.", 504);
    }
    // Fallo de red (host inalcanzable) → mensaje claro y accionable.
    throw new McpError(MCP_UNREACHABLE_MSG, 503);
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text();
  if (!res.ok) {
    throw new McpError(
      `MCP responded ${res.status}: ${raw.slice(0, 300).replace(/\s+/g, " ").trim()}`,
      res.status
    );
  }

  const msg = parseMcpPayload(raw);
  if (!msg) {
    throw new McpError(
      `MCP returned an unparseable response: ${raw.slice(0, 200)}`
    );
  }
  if (msg.error) {
    throw new McpError(
      `MCP error: ${msg.error.message ?? JSON.stringify(msg.error)}`
    );
  }

  const result = msg.result ?? {};
  const text = ((result.content ?? []) as Array<{ type?: string; text?: string }>)
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n")
    .trim();

  const sources: McpSource[] =
    result.structuredContent?.data?.sources ??
    result.structuredContent?.sources ??
    [];

  return { text, sources, isError: Boolean(result.isError), raw: result };
}

/** Q&A documentado sobre la base de conocimiento de Dynamic Yield. */
export async function getDyKnowledge(query: string): Promise<McpToolResult> {
  return mcpCallTool("get_dy_knowledge", { query });
}
