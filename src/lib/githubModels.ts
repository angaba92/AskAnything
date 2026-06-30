/**
 * Cliente para GitHub Models (API compatible con OpenAI).
 *   Base:   https://models.github.ai/inference
 *   Auth:   PAT de GitHub con permiso `models:read`  (header Authorization: Bearer)
 *
 * Da los dos motores que necesita el RAG:
 *   - embeddings: openai/text-embedding-3-small
 *   - chat:       openai/gpt-4o-mini  (redacta la respuesta final)
 *
 * Configurar en .env.local:
 *   GITHUB_MODELS_TOKEN="github_pat_..."
 *   (opcional) GITHUB_MODELS_CHAT="openai/gpt-4o-mini"
 *   (opcional) GITHUB_MODELS_EMBED="openai/text-embedding-3-small"
 */

const BASE =
  process.env.GITHUB_MODELS_BASE ?? "https://models.github.ai/inference";

export const CHAT_MODEL =
  process.env.GITHUB_MODELS_CHAT ?? "openai/gpt-4.1-mini";
export const EMBED_MODEL =
  process.env.GITHUB_MODELS_EMBED ?? "openai/text-embedding-3-small";

export class GitHubModelsError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "GitHubModelsError";
  }
}

export function isGitHubModelsConfigured(): boolean {
  return Boolean(process.env.GITHUB_MODELS_TOKEN);
}

function token(): string {
  const t = process.env.GITHUB_MODELS_TOKEN;
  if (!t) {
    throw new GitHubModelsError(
      503,
      "GitHub Models no configurado. Define GITHUB_MODELS_TOKEN (PAT con models:read) en .env.local."
    );
  }
  return t;
}

async function call(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token()}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const raw = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new GitHubModelsError(
      res.status,
      `GitHub Models respondió ${res.status}. Revisa el PAT (models:read) y que GitHub Models esté habilitado en tu organización.`
    );
  }
  if (res.status === 429) {
    throw new GitHubModelsError(
      429,
      "GitHub Models: límite de peticiones alcanzado (rate limit). Espera un momento y reintenta."
    );
  }
  if (!res.ok) {
    throw new GitHubModelsError(
      res.status,
      `GitHub Models respondió ${res.status}: ${raw.slice(0, 300)}`
    );
  }
  return raw ? JSON.parse(raw) : {};
}

/** Genera embeddings para uno o varios textos. Devuelve un array de vectores. */
export async function embed(input: string | string[]): Promise<number[][]> {
  const arr = Array.isArray(input) ? input : [input];
  if (arr.length === 0) return [];
  const data = await call("/embeddings", { model: EMBED_MODEL, input: arr });
  // Respeta el orden por `index`.
  const items: Array<{ index: number; embedding: number[] }> = data.data ?? [];
  items.sort((a, b) => a.index - b.index);
  return items.map((d) => d.embedding);
}

/** Chat completion simple (no streaming). Devuelve el texto del asistente. */
export async function chat(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const data = await call("/chat/completions", {
    model: CHAT_MODEL,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 800,
  });
  return data.choices?.[0]?.message?.content ?? "";
}

/** Comprueba conectividad/credenciales con una llamada mínima de embeddings. */
export async function ping(): Promise<{ ok: boolean; model: string }> {
  await embed("ping");
  return { ok: true, model: EMBED_MODEL };
}
