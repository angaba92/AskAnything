import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { requestUser } from "@/lib/requestUser";

export const dynamic = "force-dynamic";

/** Creates a local conversation for the stateless Knowledge Assistant. */
export async function POST(req: Request) {
  try {
    const owner = requestUser(req);
    const thread = await prisma.thread.create({
      data: { id: `local-${randomUUID()}`, owner },
    });
    return NextResponse.json({ id: thread.id });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
