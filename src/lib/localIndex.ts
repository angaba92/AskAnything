/**
 * Índice léxico local (BM25) en TypeScript puro — sin dependencias nativas,
 * sin descargas de modelos y sin permisos de admin. Funciona 100% offline.
 *
 * Suficiente para emparejar una pregunta de RFP nueva con las preguntas/pasajes
 * más parecidos del knowledge base. Cuando haya un motor de embeddings o LLM
 * disponible, se puede añadir como mejora encima de esto.
 */

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are",
  "be", "with", "as", "by", "at", "this", "that", "it", "from", "your", "you",
  "we", "our", "do", "does", "can", "will", "how", "what", "which", "please",
  "el", "la", "los", "las", "un", "una", "y", "o", "de", "del", "en", "para",
  "por", "con", "que", "se", "es", "son", "como", "su", "sus", "al", "lo",
]);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9áéíóúñü]+/gi) ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export interface IndexDoc {
  id: string;
  tokens: string[];
}

export interface Bm25Result {
  id: string;
  score: number;
}

/**
 * Calcula BM25 de `query` contra una colección de documentos ya tokenizados.
 * k1/b son los parámetros estándar de BM25.
 */
export function bm25Search(
  query: string,
  docs: IndexDoc[],
  topK = 6,
  k1 = 1.5,
  b = 0.75
): Bm25Result[] {
  const N = docs.length;
  if (N === 0) return [];

  // Frecuencia de documento por término.
  const df = new Map<string, number>();
  let totalLen = 0;
  for (const d of docs) {
    totalLen += d.tokens.length;
    const seen = new Set(d.tokens);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const avgdl = totalLen / N || 1;

  const qTerms = Array.from(new Set(tokenize(query)));
  const idf = new Map<string, number>();
  for (const t of qTerms) {
    const n = df.get(t) ?? 0;
    // IDF de BM25 (con suavizado), nunca negativo.
    idf.set(t, Math.max(0, Math.log((N - n + 0.5) / (n + 0.5) + 1)));
  }

  const results: Bm25Result[] = [];
  for (const d of docs) {
    const len = d.tokens.length || 1;
    const tf = new Map<string, number>();
    for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    for (const t of qTerms) {
      const f = tf.get(t);
      if (!f) continue;
      const numerator = f * (k1 + 1);
      const denominator = f + k1 * (1 - b + (b * len) / avgdl);
      score += (idf.get(t) ?? 0) * (numerator / denominator);
    }
    if (score > 0) results.push({ id: d.id, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}
