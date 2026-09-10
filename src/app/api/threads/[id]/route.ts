import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getThread, DyAuthError } from "@/lib/dyClient";
import { persistMessages, deriveTitle } from "@/lib/persist";
import { requestUser } from "@/lib/requestUser";

export const dynamic = "force-dynamic";

/**
 * GET /api/threads/[id]?sync=1
 * Devuelve los mensajes locales del thread. Con ?sync=1 primero los
 * refresca desde DY.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const sync = req.nextUrl.searchParams.get("sync");
  const owner = requestUser(req);

  let thread = await prisma.thread.findFirst({
    where: { id, owner },
    include: { messages: { orderBy: { seqId: "asc" } } },
  });
  if (!thread) {
    return NextResponse.json({ error: "Thread no encontrado" }, { status: 404 });
  }

  try {
    // MIGRACIÓN KA: section=null identifica hilos locales de KA/MCP. Aunque un
    // cliente antiguo envíe ?sync=1, nunca intentamos consultar DY para ellos.
    if (sync && thread.section) {
      const dy = await getThread(id);
      await persistMessages(id, dy.messages);
      const title = deriveTitle(dy.messages);
      if (title) {
        await prisma.thread.update({ where: { id }, data: { title } }).catch(() => {});
      }
      thread = await prisma.thread.findFirstOrThrow({
        where: { id, owner },
        include: { messages: { orderBy: { seqId: "asc" } } },
      });
    }
  } catch (err) {
    if (err instanceof DyAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  return NextResponse.json({
    id: thread.id,
    title: thread.title,
    status: thread.status,
    tags: JSON.parse(thread.tags) as string[],
    messages: thread.messages.map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      seqId: m.seqId,
      createdAt: m.createdAt,
      meta: JSON.parse(m.meta),
    })),
  });
}
