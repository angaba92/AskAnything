/**
 * Runtime store for the Dynamic Yield session (cookie + section id).
 *
 * Problem: the DY cookie (personal SSO session) expires every few hours. If it
 * only lived in .env.local, refreshing it would force a server restart and
 * leave the team without service. Solution: we persist the live cookie so it
 * can be updated HOT from the /settings page or the browser extension. One
 * person refreshes the shared session in seconds and the whole team keeps using
 * the app.
 *
 * Storage is resilient so it works everywhere:
 *   - Primary: the database (Setting table, key "dy_session"). Works on
 *     serverless hosts (e.g. Vercel) where the filesystem is read-only/ephemeral.
 *   - Fallback: a local file (.dy-session.json, gitignored) for local dev when
 *     no database is configured yet.
 *   - Last resort: environment variables (.env.local).
 *
 * Read priority: DB row > local file > environment.
 */
import { promises as fs } from "fs";
import path from "path";
import { prisma } from "./db";

const KEY = "dy_session";
const FILE = path.join(process.cwd(), ".dy-session.json");

export interface DySession {
  cookie: string;
  sectionId: string;
  updatedAt: string;
}

export interface ResolvedDySession {
  cookie?: string;
  sectionId: string;
  source: "db" | "file" | "env" | "none";
  updatedAt?: string;
}

let cache: DySession | null | undefined; // undefined = not read yet
let cacheSource: "db" | "file" = "db";

async function readStore(): Promise<DySession | null> {
  if (cache !== undefined) return cache;
  // 1) Database (works on serverless).
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY } });
    if (row) {
      cache = JSON.parse(row.value) as DySession;
      cacheSource = "db";
      return cache;
    }
  } catch {
    /* DB not configured/reachable — fall through to file. */
  }
  // 2) Local file (local dev without a database).
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    cache = JSON.parse(raw) as DySession;
    cacheSource = "file";
    return cache;
  } catch {
    /* no file */
  }
  cache = null;
  return cache;
}

/** Returns the live session: DB row > local file > environment. */
export async function getDySession(): Promise<ResolvedDySession> {
  const stored = await readStore();
  if (stored?.cookie) {
    return {
      cookie: stored.cookie,
      sectionId: stored.sectionId || process.env.DY_SECTION_ID || "",
      source: cacheSource,
      updatedAt: stored.updatedAt,
    };
  }
  const envCookie = process.env.DY_COOKIE;
  if (envCookie) {
    return {
      cookie: envCookie,
      sectionId: process.env.DY_SECTION_ID || "",
      source: "env",
    };
  }
  return { sectionId: process.env.DY_SECTION_ID || "", source: "none" };
}

/**
 * Saves (hot) a new session cookie for the whole team. Never throws: it tries
 * the database first and falls back to a local file, so a missing/unreachable
 * DB in local dev does not break the /settings flow.
 */
export async function setDySession(cookie: string, sectionId?: string): Promise<DySession> {
  const session: DySession = {
    cookie: cookie.trim(),
    sectionId: (sectionId ?? process.env.DY_SECTION_ID ?? "").trim(),
    updatedAt: new Date().toISOString(),
  };
  const value = JSON.stringify(session);

  let savedToDb = false;
  try {
    await prisma.setting.upsert({
      where: { key: KEY },
      create: { key: KEY, value },
      update: { value },
    });
    savedToDb = true;
  } catch {
    /* DB not available — fall back to file below. */
  }
  try {
    await fs.writeFile(FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
  } catch {
    /* read-only FS (e.g. Vercel) — DB write above is the source of truth. */
  }

  cache = session;
  cacheSource = savedToDb ? "db" : "file";
  return session;
}

/**
 * Acepta una cookie pegada directamente O un comando cURL completo
 * ("Copy as cURL" del navegador) y extrae el valor de la cookie.
 * Soporta `-b '...'`, `--cookie '...'` y `-H 'cookie: ...'`.
 */
export function extractCookie(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  // -b $'...'  |  -b '...'  |  --cookie '...'
  const b = s.match(/(?:-b|--cookie)\s+\$?'((?:[^'\\]|\\.)*)'/);
  if (b) return unescapeCurl(b[1]);
  const bDouble = s.match(/(?:-b|--cookie)\s+"((?:[^"\\]|\\.)*)"/);
  if (bDouble) return unescapeCurl(bDouble[1]);

  // -H 'cookie: ...'
  const h = s.match(/-H\s+'cookie:\s*((?:[^'\\]|\\.)*)'/i);
  if (h) return unescapeCurl(h[1]);
  const hDouble = s.match(/-H\s+"cookie:\s*((?:[^"\\]|\\.)*)"/i);
  if (hDouble) return unescapeCurl(hDouble[1]);

  // Si parece una cookie cruda (contiene "=" y ";"), úsala tal cual.
  if (/=/.test(s) && !s.startsWith("curl")) return s;

  return null;
}

function unescapeCurl(v: string): string {
  // cURL de Chrome escapa con $'...' usando \u0021, \', etc.
  return v
    .replace(/\\u0021/g, "!")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

/** ¿La cookie contiene el XSRF-TOKEN necesario? */
export function hasXsrf(cookie: string): boolean {
  return /(?:^|;\s*)XSRF-TOKEN=/i.test(cookie);
}

/** Enmascara la cookie para mostrarla sin filtrar el valor completo. */
export function maskCookie(cookie?: string): string {
  if (!cookie) return "";
  if (cookie.length <= 24) return "••••";
  return `${cookie.slice(0, 12)}…${cookie.slice(-8)} (${cookie.length} chars)`;
}
