import { NextRequest, NextResponse } from "next/server";

const AUTH_REALM_BASE = "AskAnything internal demo";
const FORCE_REAUTH_COOKIE = "aa_force_reauth";

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

function normalizeUsersList(raw: string): string {
  const normalized = normalizeToken(raw).replace(
    /^DEMO_AUTH_USERS\s*=\s*/i,
    "",
  );
  return normalized.replace(/\u00a0/g, " ").trim();
}

function loadCredentials(): Map<string, string> {
  const creds = new Map<string, string>();
  const list = process.env.DEMO_AUTH_USERS;
  if (list) {
    const normalizedList = normalizeUsersList(list);
    for (const pair of normalizedList.split(/[,\n;]+/)) {
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

function unauthorizedResponse(req: NextRequest, realm: string, clearReauth: boolean) {
  const res = new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${realm}", charset="UTF-8"`,
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });

  if (clearReauth) {
    res.cookies.set(FORCE_REAUTH_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 0,
    });
  }

  return res;
}

export function middleware(req: NextRequest) {
  const creds = loadCredentials();

  if (creds.size === 0) return NextResponse.next();

  const forceReauth = req.cookies.get(FORCE_REAUTH_COOKIE)?.value;
  if (forceReauth) {
    return unauthorizedResponse(
      req,
      `${AUTH_REALM_BASE} (${forceReauth})`,
      true,
    );
  }

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

  return unauthorizedResponse(req, AUTH_REALM_BASE, false);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
