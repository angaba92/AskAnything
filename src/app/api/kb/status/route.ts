import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isGitHubModelsConfigured } from "@/lib/githubModels";

export const dynamic = "force-dynamic";

/** GET /api/kb/status → inventario del KB + si hay redactor IA disponible. */
export async function GET() {
  const docs = await prisma.kbDoc.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, kind: true, chunks: true, createdAt: true },
  });
  const totalChunks = docs.reduce((s, d) => s + d.chunks, 0);
  return NextResponse.json({
    configured: true, // el KB local siempre funciona (BM25)
    aiWriter: isGitHubModelsConfigured(), // redactor LLM opcional
    docs,
    totalChunks,
  });
}

/** DELETE /api/kb/status?id=... → borra un documento (o todo si id=all). */
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id === "all") {
    await prisma.kbDoc.deleteMany({});
  } else if (id) {
    await prisma.kbDoc.delete({ where: { id } }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
