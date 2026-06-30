import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createThread, DyAuthError } from "@/lib/dyClient";

export const dynamic = "force-dynamic";

/** POST /api/threads/new -> crea un thread en DY y lo guarda localmente. */
export async function POST() {
  try {
    const dy = await createThread();
    const thread = await prisma.thread.upsert({
      where: { id: dy.threadId },
      create: { id: dy.threadId },
      update: {},
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
