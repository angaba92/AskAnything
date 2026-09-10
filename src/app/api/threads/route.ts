import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requestUser } from "@/lib/requestUser";

export const dynamic = "force-dynamic";

/** GET /api/threads -> lista de threads locales (para el sidebar). */
export async function GET(req: NextRequest) {
  const owner = requestUser(req);
  const threads = await prisma.thread.findMany({
    where: { owner },
    orderBy: { updatedAt: "desc" },
    include: {
      messages: {
        orderBy: { seqId: "desc" },
        take: 1,
      },
    },
  });
  return NextResponse.json(
    threads.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      tags: JSON.parse(t.tags) as string[],
      updatedAt: t.updatedAt,
      lastMessage: t.messages[0]?.text ?? "",
    }))
  );
}

/** PATCH /api/threads -> actualiza status/tags/title de un thread local. */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, status, tags, title } = body as {
    id: string;
    status?: string;
    tags?: string[];
    title?: string;
  };
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  const owner = requestUser(req);

  const data: Record<string, unknown> = {};
  if (status) data.status = status;
  if (Array.isArray(tags)) data.tags = JSON.stringify(tags);
  if (title) data.title = title;

  const thread = await prisma.thread.findFirst({ where: { id, owner } });
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  const updated = await prisma.thread.update({ where: { id }, data });
  return NextResponse.json({ ok: true, thread: updated });
}
