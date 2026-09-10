import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requestUser } from "@/lib/requestUser";

export const dynamic = "force-dynamic";

/** Returns a locally persisted Knowledge Assistant conversation. */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const owner = requestUser(req);

  const thread = await prisma.thread.findFirst({
    where: { id, owner },
    include: { messages: { orderBy: { seqId: "asc" } } },
  });
  if (!thread) {
    return NextResponse.json({ error: "Thread no encontrado" }, { status: 404 });
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
