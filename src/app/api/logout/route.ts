import { NextRequest, NextResponse } from "next/server";

const FORCE_REAUTH_COOKIE = "aa_force_reauth";

function logoutRedirect(req: NextRequest) {
  const nonce = `${Date.now()}`;
  const res = NextResponse.redirect(new URL("/", req.url));

  res.cookies.set(FORCE_REAUTH_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 120,
  });

  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Pragma", "no-cache");
  return res;
}

export async function GET(req: NextRequest) {
  return logoutRedirect(req);
}

export async function POST(req: NextRequest) {
  return logoutRedirect(req);
}
