import { prisma } from "@/lib/db";
import { bm25Search, tokenize } from "@/lib/localIndex";

export interface Retrieved {
  id: string;
  source: string;
  kind: string;
  question: string | null;
  text: string;
  score: number;
}

export async function kbChunkCount(): Promise<number> {
  return prisma.kbChunk.count();
}

/**
 * Recupera los top-k chunks más relevantes para la consulta usando BM25 local
 * (sin embeddings, sin API). Para Q&A puntúa sobre la pregunta + la respuesta.
 */
export async function retrieve(query: string, k = 6): Promise<Retrieved[]> {
  const rows = await prisma.kbChunk.findMany({
    select: { id: true, source: true, kind: true, question: true, text: true },
  });
  if (rows.length === 0) return [];

  const docs = rows.map((r) => ({
    id: r.id,
    tokens: tokenize(`${r.question ?? ""} ${r.text}`),
  }));

  const hits = bm25Search(query, docs, k);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const max = hits[0]?.score ?? 1;
  return hits.map((h) => {
    const r = byId.get(h.id)!;
    return {
      id: r.id,
      source: r.source,
      kind: r.kind,
      question: r.question,
      text: r.text,
      score: max > 0 ? h.score / max : 0,
    };
  });
}
