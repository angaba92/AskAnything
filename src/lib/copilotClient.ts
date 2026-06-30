/**
 * Cliente server-side para la Microsoft 365 Copilot Chat API (Microsoft Graph).
 *
 * Auth: SOLO delegada (en nombre del usuario). Usamos OAuth2 *device code flow*
 * con MSAL: te logueas una vez en el navegador y el token (+ refresh) se cachea
 * en disco, de modo que las llamadas siguientes son silenciosas.
 *
 * Requiere en .env.local:
 *   AZURE_TENANT_ID   (GUID del tenant de Mastercard)
 *   AZURE_CLIENT_ID   (App registration con "Allow public client flows" = Yes)
 *
 * La app de Entra debe tener consentidos estos permisos delegados de Graph:
 *   Sites.Read.All, Mail.Read, People.Read.All, OnlineMeetingTranscript.Read.All,
 *   Chat.Read, ChannelMessage.Read.All, ExternalItem.Read.All
 */

import fs from "fs";
import path from "path";
import {
  PublicClientApplication,
  LogLevel,
  type Configuration,
  type DeviceCodeRequest,
  type AccountInfo,
} from "@azure/msal-node";

const GRAPH_BASE = "https://graph.microsoft.com/beta";

export const COPILOT_SCOPES = [
  "Sites.Read.All",
  "Mail.Read",
  "People.Read.All",
  "OnlineMeetingTranscript.Read.All",
  "Chat.Read",
  "ChannelMessage.Read.All",
  "ExternalItem.Read.All",
  "offline_access",
];

const CACHE_PATH = path.join(process.cwd(), ".copilot-token-cache.json");

export class CopilotConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopilotConfigError";
  }
}

export class CopilotAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopilotAuthError";
  }
}

/** Estado de un login device-code en curso (en memoria del proceso). */
interface PendingLogin {
  userCode: string;
  verificationUri: string;
  message: string;
  startedAt: number;
  done: boolean;
  error?: string;
}
let pendingLogin: PendingLogin | null = null;

let pca: PublicClientApplication | null = null;

function getConfig() {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  if (!tenantId || !clientId) {
    throw new CopilotConfigError(
      "M365 Copilot no está configurado. Define AZURE_TENANT_ID y AZURE_CLIENT_ID en .env.local (ver .env.local.example)."
    );
  }
  return { tenantId, clientId };
}

export function isCopilotConfigured(): boolean {
  return Boolean(process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID);
}

function getClient(): PublicClientApplication {
  if (pca) return pca;
  const { tenantId, clientId } = getConfig();

  const cachePlugin = {
    beforeCacheAccess: async (ctx: { tokenCache: { deserialize: (s: string) => void } }) => {
      if (fs.existsSync(CACHE_PATH)) {
        ctx.tokenCache.deserialize(fs.readFileSync(CACHE_PATH, "utf-8"));
      }
    },
    afterCacheAccess: async (ctx: {
      cacheHasChanged: boolean;
      tokenCache: { serialize: () => string };
    }) => {
      if (ctx.cacheHasChanged) {
        fs.writeFileSync(CACHE_PATH, ctx.tokenCache.serialize());
      }
    },
  };

  const config: Configuration = {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
    cache: { cachePlugin },
    system: {
      loggerOptions: {
        loggerCallback: () => {},
        piiLoggingEnabled: false,
        logLevel: LogLevel.Error,
      },
    },
  };
  pca = new PublicClientApplication(config);
  return pca;
}

async function getCachedAccount(): Promise<AccountInfo | null> {
  const client = getClient();
  const accounts = await client.getTokenCache().getAllAccounts();
  return accounts[0] ?? null;
}

/** ¿Hay una sesión válida (cuenta cacheada) para llamar a Copilot? */
export async function copilotAuthStatus(): Promise<{
  configured: boolean;
  authenticated: boolean;
  account?: string;
  pending?: PendingLogin | null;
}> {
  if (!isCopilotConfigured()) return { configured: false, authenticated: false };
  const account = await getCachedAccount();
  return {
    configured: true,
    authenticated: Boolean(account),
    account: account?.username,
    pending: pendingLogin && !pendingLogin.done ? pendingLogin : null,
  };
}

/**
 * Inicia el device-code flow. Devuelve inmediatamente el código y la URL que el
 * usuario debe visitar; el login se completa en segundo plano y, al terminar,
 * el token queda cacheado en disco.
 */
export async function startDeviceLogin(): Promise<PendingLogin> {
  const client = getClient();

  if (pendingLogin && !pendingLogin.done) return pendingLogin;

  // Promesa que resolveremos en el callback con los datos del código.
  let resolveInfo!: (p: PendingLogin) => void;
  const infoReady = new Promise<PendingLogin>((r) => (resolveInfo = r));

  const request: DeviceCodeRequest = {
    scopes: COPILOT_SCOPES,
    deviceCodeCallback: (response) => {
      pendingLogin = {
        userCode: response.userCode,
        verificationUri: response.verificationUri,
        message: response.message,
        startedAt: Date.now(),
        done: false,
      };
      resolveInfo(pendingLogin);
    },
  };

  // Lanzamos la adquisición en segundo plano (bloquea hasta que el usuario
  // completa el login en el navegador).
  client
    .acquireTokenByDeviceCode(request)
    .then(() => {
      if (pendingLogin) pendingLogin.done = true;
    })
    .catch((err) => {
      if (pendingLogin) {
        pendingLogin.done = true;
        pendingLogin.error = (err as Error).message;
      }
    });

  return infoReady;
}

/** Obtiene un access token de Graph de forma silenciosa (refresca si hace falta). */
async function getToken(): Promise<string> {
  const client = getClient();
  const account = await getCachedAccount();
  if (!account) {
    throw new CopilotAuthError(
      "No hay sesión de Copilot. Inicia sesión con el botón 'Connect Copilot' (device code)."
    );
  }
  try {
    const result = await client.acquireTokenSilent({
      account,
      scopes: COPILOT_SCOPES,
    });
    return result.accessToken;
  } catch {
    throw new CopilotAuthError(
      "La sesión de Copilot caducó. Vuelve a conectar con 'Connect Copilot'."
    );
  }
}

async function graphFetch(url: string, init: RequestInit): Promise<any> {
  const token = await getToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const raw = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new CopilotAuthError(
      `Graph respondió ${res.status}. Revisa que la app tenga consentidos los permisos Copilot y vuelve a conectar.`
    );
  }
  if (!res.ok) {
    throw new Error(`Graph respondió ${res.status}: ${raw.slice(0, 400)}`);
  }
  return raw ? JSON.parse(raw) : {};
}

/** Crea una conversación de Copilot y devuelve su id. */
async function createConversation(): Promise<string> {
  const data = await graphFetch(`${GRAPH_BASE}/copilot/conversations`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!data.id) throw new Error("Copilot no devolvió un conversationId.");
  return data.id as string;
}

export interface CopilotAnswer {
  answer: string;
  conversationId: string;
}

/**
 * Envía una pregunta a M365 Copilot (crea conversación nueva + chat) y devuelve
 * el texto de la respuesta del asistente.
 */
export async function askCopilot(
  question: string,
  opts: { webSearch?: boolean; timeZone?: string } = {}
): Promise<CopilotAnswer> {
  const conversationId = await createConversation();
  const body: Record<string, unknown> = {
    message: { text: question },
    locationHint: { timeZone: opts.timeZone ?? "Europe/Madrid" },
  };
  if (opts.webSearch === false) {
    body.contextualResources = { webSearch: { enabled: false } };
  }

  const data = await graphFetch(
    `${GRAPH_BASE}/copilot/conversations/${conversationId}/chat`,
    { method: "POST", body: JSON.stringify(body) }
  );

  // La respuesta del asistente es el último mensaje (el primero suele ser el
  // eco de la pregunta del usuario).
  const messages: Array<{ text?: string }> = data.messages ?? [];
  const answer = messages.length ? messages[messages.length - 1].text ?? "" : "";
  return { answer, conversationId };
}
