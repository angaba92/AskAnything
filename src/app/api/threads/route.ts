import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/threads -> lista de threads locales (para el sidebar). */
export async function GET() {
  const threads = await prisma.thread.findMany({
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
      owner: t.owner ?? null,
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

  const data: Record<string, unknown> = {};
  if (status) data.status = status;
  if (Array.isArray(tags)) data.tags = JSON.stringify(tags);
  if (title) data.title = title;

  const updated = await prisma.thread.update({ where: { id }, data });
  return NextResponse.json({ ok: true, thread: updated });
}
