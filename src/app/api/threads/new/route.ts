import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createThread, DyAuthError } from "@/lib/dyClient";
import { nextChatSection } from "@/lib/sections";

export const dynamic = "force-dynamic";

/** Extrae el usuario del header Basic Auth (el login del middleware). */
function authUser(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    const user = (idx > 0 ? decoded.slice(0, idx) : decoded).trim();
    return user || null;
  } catch {
    return null;
  }
}

/** POST /api/threads/new -> crea un thread en DY y lo guarda localmente.
 * Usa una sección del pool de CHAT (rotando) para que cada conversación nueva
 * caiga en un thread distinto e independiente del batch y de otros usuarios.
 * El owner se toma del usuario logueado (Basic Auth). */
export async function POST(req: Request) {
  try {
    const owner = authUser(req);
    const section = await nextChatSection();
    const dy = await createThread(section);
    const thread = await prisma.thread.upsert({
      where: { id: dy.threadId },
      create: { id: dy.threadId, section, owner },
      update: { section, ...(owner ? { owner } : {}) },
    });
    return NextResponse.json({ id: thread.id });
  } catch (err) {
    if (err instanceof DyAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
