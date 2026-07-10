import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createThread, DyAuthError } from "@/lib/dyClient";
import { nextChatSection } from "@/lib/sections";

export const dynamic = "force-dynamic";

/** POST /api/threads/new -> crea un thread en DY y lo guarda localmente.
 * Usa una sección del pool de CHAT (rotando) para que cada conversación nueva
 * caiga en un thread distinto e independiente del batch y de otros usuarios. */
export async function POST(req: Request) {
  try {
    const owner = await req
      .json()
      .then((b) => (typeof b?.owner === "string" ? b.owner.trim() || null : null))
      .catch(() => null);
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
