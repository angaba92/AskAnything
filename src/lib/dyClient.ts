/**
 * Cliente server-side para el backend "Experience OS Agents" de Dynamic Yield.
 * Todas las llamadas se hacen desde el servidor (API routes) para evitar CORS
 * y para no exponer la Cookie / x-xsrf-token al navegador.
 */

const BASE = process.env.DY_BASE_URL ?? "https://adm.dynamicyield.com";

import { getDySession } from "./dySession";
import { wrapWithTemplate, isTemplateEnabled, resolveMode } from "./promptTemplate";

export interface DyMessage {
  id: string;
  role: "human" | "ai";
  text: string;
  seqId?: number;
  createdAt?: string;
  agentMetadata?: { toolsUsed?: string[]; expertSelected?: string };
  artifactMetadata?: { id?: string; type?: string; title?: string | null };
  interactionId?: string;
}

export interface DyChatResponse {
  threadId: string;
  messages: DyMessage[];
}

export class DyAuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "DyAuthError";
  }
}

/** Error transitorio de DY (p. ej. 503 LLM_SERVICE_ERROR) — se puede reintentar. */
export class DyTransientError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "DyTransientError";
  }
}

function extractXsrf(cookie: string): string | undefined {
  const m = cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/i);
  return m ? decodeURIComponent(m[1]) : undefined;
}

async function authHeaders(extra: Record<string, string> = {}): Promise<HeadersInit> {
  const session = await getDySession();
  const cookie = session.cookie;
  const sectionId = session.sectionId;
  // El x-xsrf-token es el valor de la cookie XSRF-TOKEN; lo derivamos de la
  // cookie para que nunca se desincronicen. Permitimos override manual.
  const xsrf = process.env.DY_XSRF_TOKEN || (cookie ? extractXsrf(cookie) : undefined);

  if (!cookie || !xsrf) {
    throw new DyAuthError(
      401,
      "Missing DY cookie (or it has no XSRF-TOKEN). Paste it in /settings or in .env.local (see .env.local.example)."
    );
  }

  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    cookie,
    "x-xsrf-token": xsrf,
    dy_section_id: sectionId,
    origin: BASE,
    ...extra,
  };
}

async function handle(res: Response): Promise<DyChatResponse> {
  // Si la sesión caducó, el proxy oauth2 responde 401/403 o redirige (3xx)
  // a la página de login SSO (HTML). Lo detectamos y damos un error claro.
  if (res.status === 401 || res.status === 403) {
    throw new DyAuthError(
      res.status,
      "Session expired (DY returned 403/401). Re-copy the cookie with 'Copy as cURL' from your browser and update it in /settings."
    );
  }
  if (res.status >= 300 && res.status < 400) {
    throw new DyAuthError(
      res.status,
      "Session expired: DY is redirecting to the SSO login. Refresh the cookie in /settings."
    );
  }

  const ct = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  if (!ct.includes("application/json") || raw.trimStart().startsWith("<")) {
    throw new DyAuthError(
      401,
      "Session expired: DY returned the login page instead of JSON. Refresh the cookie in /settings."
    );
  }
  if (!res.ok && res.status !== 304) {
    // DY a veces devuelve 5xx / LLM_SERVICE_ERROR / INTERNAL_ERROR de forma
    // transitoria (sobre todo bajo la carga del batch). Lo marcamos como
    // reintentable para que sendMessageWithRetry lo reintente con backoff.
    if (
      res.status >= 500 ||
      res.status === 429 ||
      /LLM_SERVICE_ERROR|INTERNAL_ERROR|temporarily unavailable|try again later|rate.?limit|too many requests/i.test(
        raw,
      )
    ) {
      throw new DyTransientError(
        res.status,
        "DY's AI service is temporarily unavailable (transient error). This is on Dynamic Yield's side — retrying with backoff."
      );
    }
    throw new Error(`DY responded ${res.status}: ${raw.slice(0, 300)}`);
  }
  return JSON.parse(raw) as DyChatResponse;
}

const IN_BAND_ERROR_PATTERNS = [
  /^\s*something went wrong,?\s*try again\.?\s*$/i,
  /^\s*try again later\.?\s*$/i,
];

/** Detecta mensajes de error que DY devuelve dentro de una respuesta 200. */
function isInBandError(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return true;
  if (IN_BAND_ERROR_PATTERNS.some((re) => re.test(t))) return true;
  // Códigos de error solo si el mensaje es corto (un blob de error, no prosa
  // que casualmente los mencione).
  if (t.length < 200 && /INTERNAL_ERROR|LLM_SERVICE_ERROR/.test(t)) return true;
  return false;
}

/** Crea un nuevo thread vacío y devuelve su threadId. */
export async function createThread(): Promise<DyChatResponse> {
  const res = await fetch(`${BASE}/agents/chats/new`, {
    method: "POST",
    headers: await authHeaders(),
    cache: "no-store",
    redirect: "manual",
  });
  return handle(res);
}

/**
 * Envía un mensaje a un thread y devuelve la(s) respuesta(s) del agente.
 * `mode` ("simple" | "detailed" | "bulleted") elige la plantilla de respuesta.
 * Se acepta `structured` por compatibilidad (true → detailed, false → simple).
 */
export async function sendMessage(
  threadId: string,
  message: string,
  opts: { structured?: boolean; mode?: string } = {}
): Promise<DyChatResponse> {
  const sectionId = Number((await getDySession()).sectionId || "0");
  const mode = resolveMode(opts);
  const text =
    mode !== "simple" && isTemplateEnabled()
      ? wrapWithTemplate(message, mode)
      : message;
  const body = {
    message: text,
    scope: "test",
    userAdditionalData: {
      sectionId,
      availableSkills: [
        "ask_anything:knowledge_base",
        "impactReport:generate_impact_report",
        "alertNotification:investigate_my_alerts",
        "productFeed:affinity_property_ranker",
        "reportHistory:ab_test_history",
      ],
    },
  };
  const res = await fetch(`${BASE}/agents/chats/${threadId}`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "manual",
  });
  const parsed = await handle(res);
  // Solo aquí (respuesta a un envío nuevo) comprobamos si DY devolvió un error
  // "in-band" en un 200 (p. ej. "Something went wrong, try again."). NO se aplica
  // a getThread para no romper la carga del historial si contiene un error antiguo.
  const aiMsg = parsed.messages?.find((m) => m.role === "ai");
  if (aiMsg && isInBandError(aiMsg.text)) {
    throw new DyTransientError(
      502,
      "DY returned an in-band error (\"Something went wrong, try again.\"). Retrying…"
    );
  }
  return parsed;
}

/**
 * Igual que sendMessage pero reintenta los errores transitorios de DY
 * (503 / LLM_SERVICE_ERROR) con backoff. Pensado para el batch y el chat.
 */
export async function sendMessageWithRetry(
  threadId: string,
  message: string,
  opts: { structured?: boolean; mode?: string; retries?: number } = {}
): Promise<DyChatResponse> {
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await sendMessage(threadId, message, opts);
    } catch (err) {
      lastErr = err;
      if (!(err instanceof DyTransientError) || attempt === retries) throw err;
      // Backoff exponencial con tope y jitter: ~2s, 4s, 8s, 16s, 30s (±30%).
      const base = Math.min(2000 * 2 ** attempt, 30000);
      const jitter = base * (0.7 + Math.random() * 0.6);
      await new Promise((r) => setTimeout(r, jitter));
    }
  }
  throw lastErr;
}

/** Lee el historial completo de un thread desde DY. */
export async function getThread(threadId: string): Promise<DyChatResponse> {
  const res = await fetch(`${BASE}/agents/chats/${threadId}`, {
    method: "GET",
    headers: await authHeaders(),
    cache: "no-store",
    redirect: "manual",
  });
  return handle(res);
}
