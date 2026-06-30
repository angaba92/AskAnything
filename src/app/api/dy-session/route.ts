import { NextRequest, NextResponse } from "next/server";
import { createThread } from "@/lib/dyClient";
import {
  getDySession,
  setDySession,
  extractCookie,
  hasXsrf,
  maskCookie,
} from "@/lib/dySession";

export const dynamic = "force-dynamic";

/** GET /api/dy-session → estado de la sesión DY compartida (enmascarado). */
export async function GET() {
  const s = await getDySession();
  return NextResponse.json({
    source: s.source,
    hasCookie: Boolean(s.cookie),
    hasXsrf: s.cookie ? hasXsrf(s.cookie) : false,
    sectionId: s.sectionId,
    masked: maskCookie(s.cookie),
    updatedAt: s.updatedAt ?? null,
  });
}

/**
 * POST /api/dy-session { input, sectionId?, test? }
 * `input` = cookie pegada o un comando cURL completo ("Copy as cURL").
 * Guarda la sesión en caliente para todo el equipo y, si test!=false, la
 * valida creando un thread en DY.
 */
export async function POST(req: NextRequest) {
  try {
    const { input, sectionId, test } = (await req.json()) as {
      input?: string;
      sectionId?: string;
      test?: boolean;
    };

    if (!input?.trim()) {
      return NextResponse.json(
        { error: "Paste the DY cookie or the cURL command." },
        { status: 400 }
      );
    }

    const cookie = extractCookie(input);
    if (!cookie) {
      return NextResponse.json(
        { error: "Could not extract a cookie from the text. Paste the full cookie header or the cURL." },
        { status: 400 }
      );
    }
    if (!hasXsrf(cookie)) {
      return NextResponse.json(
        { error: "The cookie has no XSRF-TOKEN; copy the FULL cookie header." },
        { status: 400 }
      );
    }

    await setDySession(cookie, sectionId);

    if (test === false) {
      return NextResponse.json({ ok: true, tested: false });
    }

    // Validate against DY by creating a thread.
    try {
      await createThread();
      return NextResponse.json({ ok: true, tested: true, valid: true });
    } catch (err) {
      return NextResponse.json({
        ok: true,
        tested: true,
        valid: false,
        message: (err as Error).message,
      });
    }
  } catch (err) {
    return NextResponse.json(
      { error: "Could not save the session: " + (err as Error).message },
      { status: 500 }
    );
  }
}
