import { prisma } from "@/lib/db";
import { bm25Search, tokenize } from "@/lib/localIndex";

export interface Retrieved {
  id: string;
  source: string;
  kind: string;
  question: string | null;
  text: string;
  score: number;
  rawScore: number;
  confidence: number;
  exactQuestionMatch: boolean;
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
  const queryTokens = new Set(tokenize(query));
  const normalizedQuery = normalizeQuestion(query);
  return hits.map((h) => {
    const r = byId.get(h.id)!;
    const comparisonText = r.question ?? r.text;
    const comparisonTokens = new Set(tokenize(comparisonText));
    const shared = [...queryTokens].filter((token) => comparisonTokens.has(token)).length;
    const union = new Set([...queryTokens, ...comparisonTokens]).size || 1;
    const coverage = queryTokens.size > 0 ? shared / queryTokens.size : 0;
    const jaccard = shared / union;
    const exactQuestionMatch =
      Boolean(r.question) && normalizeQuestion(r.question ?? "") === normalizedQuery;
    const confidence = exactQuestionMatch
      ? 1
      : Math.min(0.99, (coverage * 0.72 + jaccard * 0.28) * (r.question ? 1 : 0.75));
    return {
      id: r.id,
      source: r.source,
      kind: r.kind,
      question: r.question,
      text: r.text,
      score: max > 0 ? h.score / max : 0,
      rawScore: h.score,
      confidence,
      exactQuestionMatch,
    };
  }).sort((a, b) => {
    if (a.exactQuestionMatch !== b.exactQuestionMatch) {
      return a.exactQuestionMatch ? -1 : 1;
    }
    return b.rawScore - a.rawScore;
  });
}

function normalizeQuestion(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
