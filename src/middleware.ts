import { NextRequest, NextResponse } from "next/server";

function normalizeToken(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Login inicial estilo .htaccess (HTTP Basic Auth) para el acceso del equipo.
 *
 * Off by default: si NO hay credenciales configuradas, todo pasa (dev local).
 *
 * Dos formas de configurar las credenciales (cualquiera activa el login):
 *   - DEMO_AUTH_USERS = "ana:clave1,luis:clave2"   (varios usuarios, estilo
 *     .htpasswd — recomendado para un equipo).
 *   - DEMO_AUTH_USER / DEMO_AUTH_PASSWORD          (un único usuario compartido).
 *
 * Protege páginas Y rutas API. Las credenciales viven SOLO en el servidor
 * (.env.local); nunca se exponen al navegador.
 */
function loadCredentials(): Map<string, string> {
  const creds = new Map<string, string>();
  const list = process.env.DEMO_AUTH_USERS;
  if (list) {
    const normalizedList = normalizeToken(list);
    for (const pair of normalizedList.split(",")) {
      const idx = pair.indexOf(":");
      if (idx > 0) {
        const u = normalizeToken(pair.slice(0, idx));
        const p = normalizeToken(pair.slice(idx + 1));
        if (u && p) creds.set(u, p);
      }
    }
  }
  const u = process.env.DEMO_AUTH_USER
    ? normalizeToken(process.env.DEMO_AUTH_USER)
    : undefined;
  const p = process.env.DEMO_AUTH_PASSWORD
    ? normalizeToken(process.env.DEMO_AUTH_PASSWORD)
    : undefined;
  if (u && p) creds.set(u, p);
  return creds;
}

export function middleware(req: NextRequest) {
  const creds = loadCredentials();

  // Gate disabled when no credentials configured.
  if (creds.size === 0) return NextResponse.next();

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(":");
      const u = normalizeToken(decoded.slice(0, idx));
      const p = normalizeToken(decoded.slice(idx + 1));
      if (creds.get(u) === p) return NextResponse.next();
    } catch {
      // fall through to 401
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="AskAnything internal demo"' },
  });
}

export const config = {
  // Protect everything except Next.js internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
