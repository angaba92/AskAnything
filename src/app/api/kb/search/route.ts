import { NextRequest, NextResponse } from "next/server";
import { retrieve } from "@/lib/kb";

export const dynamic = "force-dynamic";

/** POST /api/kb/search { query, k? } → top-k chunks (BM25 local, sin IA). */
export async function POST(req: NextRequest) {
  const { query, k } = (await req.json()) as { query: string; k?: number };
  if (!query?.trim()) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  try {
    const hits = await retrieve(query.trim(), k ?? 6);
    return NextResponse.json({ ok: true, hits });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
