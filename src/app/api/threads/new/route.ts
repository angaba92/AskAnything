import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { createThread, DyAuthError } from "@/lib/dyClient";
import { nextChatSection } from "@/lib/sections";
import { isStateless, resolveProvider } from "@/lib/providers";
import { requestUser } from "@/lib/requestUser";

export const dynamic = "force-dynamic";

/** POST /api/threads/new { backend? }
 * KA/MCP crean un hilo exclusivamente local. Agent Mode conserva el flujo
 * histórico: crea un thread en DY y lo guarda localmente.
 */
export async function POST(req: Request) {
  try {
    const owner = requestUser(req);
    const body = (await req.json().catch(() => ({}))) as { backend?: string };
    const provider = resolveProvider(body.backend);

    // MIGRACIÓN KA: los proveedores stateless no necesitan cookie, sección ni
    // thread remoto de Experience OS. El UUID local mantiene intactos historial,
    // estado, tags, owner y navegación.
    if (isStateless(provider)) {
      const thread = await prisma.thread.create({
        data: { id: `local-${randomUUID()}`, owner },
      });
      return NextResponse.json({ id: thread.id });
    }

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
