import { NextRequest, NextResponse } from "next/server";
import { retrieve, kbChunkCount } from "@/lib/kb";
import { chat, isGitHubModelsConfigured, GitHubModelsError } from "@/lib/githubModels";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/kb/answer { question, context?, k? }
 * 1) Recupera los chunks relevantes con BM25 local (siempre funciona).
 * 2) Si GitHub Models está disponible, un LLM redacta una respuesta fundamentada
 *    con citas. Si no, devolvemos directamente la(s) mejor(es) coincidencia(s)
 *    del banco de Q&A (modo "match", sin IA).
 */
export async function POST(req: NextRequest) {
  const { question, context, k } = (await req.json()) as {
    question: string;
    context?: string;
    k?: number;
  };
  if (!question?.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const hits = await retrieve(question.trim(), k ?? 6);
  const sources = hits.map((h, i) => ({
    n: i + 1,
    source: h.source,
    kind: h.kind,
    question: h.question,
    score: Number(h.score.toFixed(3)),
    preview: h.text.slice(0, 200),
  }));

  if (hits.length === 0) {
    const total = await kbChunkCount();
    return NextResponse.json({
      ok: true,
      mode: total === 0 ? "empty" : "nomatch",
      answer:
        total === 0
          ? "The knowledge base is empty. Upload your RFPs / Q&A / PDFs first."
          : "No close match found in the knowledge base for this question. Try rephrasing with terms used in your documents, or upload more material covering this topic.",
      sources: [],
    });
  }

  // Modo sin IA: devolvemos la mejor coincidencia directamente.
  if (!isGitHubModelsConfigured()) {
    const best = hits[0];
    const answer =
      best.kind === "qa"
        ? best.text
        : `Best matching passage from **${best.source}**:\n\n${best.text}`;
    return NextResponse.json({ ok: true, mode: "match", answer, sources });
  }

  // Modo IA: el LLM redacta con citas.
  try {
    const contextBlock = hits
      .map((h, i) =>
        h.kind === "qa"
          ? `[${i + 1}] (Q&A — ${h.source})\nQ: ${h.question}\nA: ${h.text}`
          : `[${i + 1}] (${h.source})\n${h.text}`
      )
      .join("\n\n---\n\n");

    const system =
      "You are an expert proposal/RFP writer. Answer the user's question using ONLY the provided sources. " +
      "Be concise, professional, and specific. If the sources don't contain the answer, say so honestly. " +
      "Cite the sources you used inline with their bracket numbers, e.g. [1], [2]." +
      (context?.trim() ? `\n\nAdditional context about the company/deal: ${context.trim()}` : "");
    const user = `Question: ${question.trim()}\n\nSources:\n${contextBlock}`;

    const answer = await chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { temperature: 0.2, maxTokens: 800 }
    );
    return NextResponse.json({ ok: true, mode: "ai", answer, sources });
  } catch (err) {
    // Si el LLM falla (p.ej. org sin acceso), degradamos a modo match.
    if (err instanceof GitHubModelsError) {
      const best = hits[0];
      const answer =
        (best.kind === "qa"
          ? best.text
          : `Best matching passage from **${best.source}**:\n\n${best.text}`) +
        `\n\n_(AI writer unavailable: ${err.message})_`;
      return NextResponse.json({ ok: true, mode: "match", answer, sources });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
