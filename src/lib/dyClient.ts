/**
 * Cliente server-side para el backend "Experience OS Agents" de Dynamic Yield.
 * Todas las llamadas se hacen desde el servidor (API routes) para evitar CORS
 * y para no exponer la Cookie / x-xsrf-token al navegador.
 */

const BASE = process.env.DY_BASE_URL ?? "https://adm.dynamicyield.com";

import { getDySession } from "./dySession";
import { wrapWithTemplate, isTemplateEnabled } from "./promptTemplate";

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
    throw new Error(`DY responded ${res.status}: ${raw.slice(0, 300)}`);
  }
  return JSON.parse(raw) as DyChatResponse;
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
 * Si `structured` es true (por defecto en el chat), envuelve la pregunta con la
 * plantilla de respuesta (Summary / Details / References).
 */
export async function sendMessage(
  threadId: string,
  message: string,
  opts: { structured?: boolean } = {}
): Promise<DyChatResponse> {
  const sectionId = Number((await getDySession()).sectionId || "0");
  const text =
    opts.structured && isTemplateEnabled() ? wrapWithTemplate(message) : message;
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
  return handle(res);
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
