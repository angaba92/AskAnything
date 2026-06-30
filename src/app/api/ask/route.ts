import { NextRequest, NextResponse } from "next/server";
import { createThread, sendMessage, DyAuthError } from "@/lib/dyClient";

export const dynamic = "force-dynamic";

/**
 * POST /api/ask  { question, context?, structured? }
 * Envía una pregunta puntual a DY (con contexto opcional de empresa/industria)
 * y devuelve la respuesta + metadatos. Pensado para el llenado masivo de Excel.
 * No persiste en la BD local (el batch es independiente del historial de chats).
 *
 * structured=true → respuesta detallada (Summary / Details / References, vía la
 * plantilla de dyClient). structured=false/omitido → respuesta simple y concisa.
 */
export async function POST(req: NextRequest) {
  const { question, context, structured } = (await req.json()) as {
    question: string;
    context?: string;
    structured?: boolean;
  };

  if (!question?.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const concise = structured ? "" : " concisely";
  const preamble = context?.trim()
    ? `${context.trim()}\n\nAnswer the following question independently${concise}. Do not reference previous questions.\n\nQuestion: `
    : `Answer the following question independently${concise}.\n\nQuestion: `;

  try {
    const thread = await createThread();
    const dy = await sendMessage(thread.threadId, preamble + question.trim(), {
      structured: Boolean(structured),
    });
    const m = dy.messages[0];
    return NextResponse.json({
      ok: true,
      answer: m?.text ?? "",
      expert: m?.agentMetadata?.expertSelected ?? "",
      tools: Array.from(new Set(m?.agentMetadata?.toolsUsed ?? [])).join(", "),
      threadId: thread.threadId,
    });
  } catch (err) {
    if (err instanceof DyAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
