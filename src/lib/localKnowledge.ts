import { retrieve, type Retrieved } from "./kb";

const REVIEW_CONFIDENCE = 0.72;
const HYBRID_CONTEXT_LIMIT = 4500;

export interface LocalKnowledgeResult {
  answer: string;
  sourcesText: string;
  confidence: number;
  reviewRequired: boolean;
  reviewReason: string;
  hits: Retrieved[];
}

export async function answerFromLocalKnowledge(
  question: string,
  k = 6,
): Promise<LocalKnowledgeResult> {
  const retrieved = await retrieve(question, k * 3);
  const seen = new Set<string>();
  const hits = retrieved
    .filter((hit) => {
      const key = `${normalizeAnswer(hit.question ?? "")}\u0000${normalizeAnswer(hit.text)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, k);
  if (hits.length === 0) {
    return {
      answer:
        "No supported answer was found in the local library for this question.",
      sourcesText: "",
      confidence: 0,
      reviewRequired: true,
      reviewReason:
        "No related question or supporting passage was found in the local library.",
      hits: [],
    };
  }

  const best = hits[0];
  const conflictingExactAnswers = hits.some(
    (hit, index) =>
      index > 0 &&
      best.exactQuestionMatch &&
      hit.exactQuestionMatch &&
      normalizeAnswer(hit.text) !== normalizeAnswer(best.text),
  );
  const confidence = best.confidence;
  const reviewRequired = confidence < REVIEW_CONFIDENCE || conflictingExactAnswers;
  const reviewReason = conflictingExactAnswers
    ? `The local library contains conflicting answers for the same question. Verify the selected answer from ${best.source}.`
    : confidence < REVIEW_CONFIDENCE
      ? `Low-confidence local match (${Math.round(confidence * 100)}%). Verify against the closest library question: "${best.question ?? "document passage"}".`
      : "";

  return {
    answer: best.text,
    sourcesText: formatLocalSources(hits),
    confidence,
    reviewRequired,
    reviewReason,
    hits,
  };
}

export function buildHybridKnowledgeContext(
  hits: Retrieved[],
  maxChars = HYBRID_CONTEXT_LIMIT,
): string {
  if (hits.length === 0) return "";

  const blocks: string[] = [];
  let used = 0;
  for (const [index, hit] of hits.slice(0, 4).entries()) {
    const prefix =
      `[Local Library ${index + 1}] Source: ${hit.source}; ` +
      `match confidence: ${Math.round(hit.confidence * 100)}%\n`;
    const question = hit.question ? `Stored question: ${hit.question}\n` : "";
    const remaining = maxChars - used - prefix.length - question.length;
    if (remaining <= 120) break;
    const answer = hit.text.slice(0, remaining);
    const block = `${prefix}${question}Stored answer:\n${answer}`;
    blocks.push(block);
    used += block.length + 6;
  }

  return [
    "LOCAL APPROVED LIBRARY EVIDENCE:",
    "Use this evidence together with the Knowledge Assistant. Prefer the stored answer when the question is an exact match. Do not invent claims that conflict with it.",
    blocks.join("\n\n---\n\n"),
  ].join("\n\n");
}

export function formatLocalSources(hits: Retrieved[]): string {
  return hits
    .slice(0, 4)
    .map(
      (hit) =>
        `${hit.source} (${Math.round(hit.confidence * 100)}% local match${
          hit.question ? `: ${hit.question}` : ""
        })`,
    )
    .join("; ");
}

function normalizeAnswer(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
