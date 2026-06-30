import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseFile } from "@/lib/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/kb/ingest  (multipart form-data con uno o varios "files")
 * Parsea y guarda los chunks en el knowledge base. Indexado léxico local
 * (BM25 en consulta), así que NO requiere ningún motor de embeddings ni API.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No se recibieron archivos." }, { status: 400 });
  }

  const results: Array<{ name: string; kind: string; chunks: number }> = [];

  try {
    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      const { kind, chunks } = await parseFile(file.name, buf);

      const doc = await prisma.kbDoc.create({
        data: { name: file.name, kind, chunks: chunks.length },
      });

      if (chunks.length > 0) {
        // createMany en lotes para Excels muy grandes.
        const SIZE = 500;
        for (let i = 0; i < chunks.length; i += SIZE) {
          await prisma.kbChunk.createMany({
            data: chunks.slice(i, i + SIZE).map((c) => ({
              docId: doc.id,
              source: file.name,
              kind: c.kind,
              question: c.question ?? null,
              text: c.text,
              embedding: null,
            })),
          });
        }
      }

      results.push({ name: file.name, kind, chunks: chunks.length });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, results });
}
