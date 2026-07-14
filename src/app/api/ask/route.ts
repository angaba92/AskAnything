import { NextRequest, NextResponse } from "next/server";
import { createThread, sendMessageWithRetry, DyAuthError } from "@/lib/dyClient";
import { plainifyAnswer, enforceBullets, resolveMode } from "@/lib/promptTemplate";
import { answerViaMcp } from "@/lib/knowledge";
import { McpError } from "@/lib/mcpClient";

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
  const { question, context, structured, mode, threadId, sectionId, backend } = (await req.json()) as {
    question: string;
    context?: string;
    structured?: boolean;
    mode?: string;
    threadId?: string;
    sectionId?: string;
    backend?: string;
  };

  if (!question?.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  // Backend "mcp" (get_dy_knowledge): stateless, sin secciones ni hilos.
  if (backend === "mcp") {
    try {
      const { answer, sourcesText } = await answerViaMcp(question, {
        mode,
        structured,
        context,
      });
      return NextResponse.json({
        ok: true,
        answer,
        expert: "knowledge_base",
        tools: sourcesText || "get_dy_knowledge",
        threadId: "",
      });
    } catch (err) {
      const status = err instanceof McpError ? err.status ?? 502 : 500;
      return NextResponse.json({ error: (err as Error).message }, { status });
    }
  }

  const isSimple = mode ? mode === "simple" : !structured;
  const concise = isSimple ? " concisely" : "";
  const preamble = context?.trim()
    ? `${context.trim()}\n\nAnswer the following question independently${concise}. Do not reference previous questions.\n\nQuestion: `
    : `Answer the following question independently${concise}.\n\nQuestion: `;

  try {
    // El batch rota `sectionId` cada N preguntas: cada sección resuelve a un
    // hilo distinto en DY, repartiendo la memoria y evitando que un único hilo
    // se sature. La sección debe usarse tanto al crear el hilo como al enviar.
    const section = sectionId?.trim() || undefined;
    const activeThreadId = threadId?.trim() || (await createThread(section)).threadId;
    const dy = await sendMessageWithRetry(activeThreadId, preamble + question.trim(), {
      structured: Boolean(structured),
      mode,
      sectionId: section,
    });
    const m = dy.messages[0];
    let answer = plainifyAnswer(m?.text ?? "");
    if (resolveMode({ mode, structured }) === "bulleted") {
      answer = enforceBullets(answer);
    }
    return NextResponse.json({
      ok: true,
      answer,
      expert: m?.agentMetadata?.expertSelected ?? "",
      tools: Array.from(new Set(m?.agentMetadata?.toolsUsed ?? [])).join(", "),
      threadId: activeThreadId,
    });
  } catch (err) {
    if (err instanceof DyAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
