import { NextRequest, NextResponse } from "next/server";
import { createThread, sendMessageWithRetry, DyAuthError } from "@/lib/dyClient";
import { plainifyAnswer, enforceBullets, resolveMode } from "@/lib/promptTemplate";
import { generateStateless, resolveProvider } from "@/lib/providers";
import { normalizeBridgedKaResponse } from "@/lib/providers/ka";
import { KaError } from "@/lib/kaClient";
import { McpError, isMcpReachableEnv, MCP_UNREACHABLE_MSG } from "@/lib/mcpClient";
import { MAX_CUSTOM_PROMPT_CHARS } from "@/lib/promptMapping";
import {
  answerFromLocalKnowledge,
  buildHybridKnowledgeContext,
} from "@/lib/localKnowledge";

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
  const { question, context, structured, mode, threadId, sectionId, backend, confidenceReview, customPrompt, localKaResponse } = (await req.json()) as {
    question: string;
    context?: string;
    structured?: boolean;
    mode?: string;
    threadId?: string;
    sectionId?: string;
    backend?: string;
    confidenceReview?: boolean;
    customPrompt?: string;
    localKaResponse?: string;
  };

  if (!question?.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  if (
    mode === "custom" &&
    (!customPrompt?.trim() || customPrompt.trim().length > MAX_CUSTOM_PROMPT_CHARS)
  ) {
    return NextResponse.json(
      {
        error: customPrompt?.trim()
          ? `Custom prompt is too long (${customPrompt.trim().length} characters). Maximum: ${MAX_CUSTOM_PROMPT_CHARS}.`
          : "Custom mode requires a non-empty .md prompt.",
      },
      { status: 400 },
    );
  }
  if (localKaResponse && localKaResponse.length > 500000) {
    return NextResponse.json(
      { error: "Knowledge Assistant response is too large." },
      { status: 413 },
    );
  }

  if (backend === "local") {
    const local = await answerFromLocalKnowledge(question.trim());
    return NextResponse.json({
      ok: true,
      answer: local.answer,
      expert: "local_library",
      tools: local.sourcesText || "local_library",
      threadId: "",
      reviewRequired: local.reviewRequired,
      reviewReason: local.reviewReason,
      matchConfidence: local.confidence,
    });
  }

  if (backend === "hybrid") {
    const local = await answerFromLocalKnowledge(question.trim());
    const localContext = buildHybridKnowledgeContext(
      local.hits,
      mode === "custom" ? 1800 : 4500,
    );
    const enrichedContext = [context?.trim(), localContext]
      .filter((part): part is string => Boolean(part))
      .join("\n\n");

    try {
      const generateOpts = {
        question,
        mode,
        structured,
        context: enrichedContext || undefined,
        confidenceReview,
        customPrompt,
      };
      const r = localKaResponse
        ? normalizeBridgedKaResponse(localKaResponse, generateOpts)
        : await generateStateless("ka", generateOpts);
      const localReviewRequired = local.hits.length > 0 && local.reviewRequired;
      const reviewReasons = [
        r.reviewReason,
        localReviewRequired ? local.reviewReason : "",
      ].filter(Boolean);
      return NextResponse.json({
        ok: true,
        answer: r.answer,
        expert: "knowledge_assistant + local_library",
        tools: [local.sourcesText, r.sourcesText].filter(Boolean).join("; "),
        threadId: "",
        reviewRequired: Boolean(r.reviewRequired || localReviewRequired),
        reviewReason: reviewReasons.join(" "),
        matchConfidence: local.confidence,
      });
    } catch (err) {
      if (local.hits.length > 0) {
        return NextResponse.json({
          ok: true,
          answer: local.answer,
          expert: "local_library (KA fallback)",
          tools: local.sourcesText,
          threadId: "",
          reviewRequired: true,
          reviewReason: [
            "Knowledge Assistant was unavailable; the best local-library answer was used.",
            local.reviewReason,
          ]
            .filter(Boolean)
            .join(" "),
          matchConfidence: local.confidence,
        });
      }
      const status = err instanceof KaError ? err.status ?? 502 : 500;
      return NextResponse.json({ error: (err as Error).message }, { status });
    }
  }

  // MIGRACIÓN: el proveedor por defecto pasa a ser "ka" (DY Knowledge Assistant).
  // Si el cliente no envía `backend`, resolveProvider devuelve "ka".
  const provider = resolveProvider(backend);

  // NUEVO backend por defecto: DY Knowledge Assistant (stateless, con fuentes).
  if (provider === "ka") {
    try {
      const generateOpts = {
        question,
        mode,
        structured,
        context,
        confidenceReview,
        customPrompt,
      };
      const r = localKaResponse
        ? normalizeBridgedKaResponse(localKaResponse, generateOpts)
        : await generateStateless("ka", generateOpts);
      return NextResponse.json({
        ok: true,
        answer: r.answer,
        expert: r.expert,
        tools: r.sourcesText || "knowledge_assistant",
        threadId: r.threadId,
        reviewRequired: r.reviewRequired ?? false,
        reviewReason: r.reviewReason ?? "",
      });
    } catch (err) {
      const status = err instanceof KaError ? err.status ?? 502 : 500;
      return NextResponse.json({ error: (err as Error).message }, { status });
    }
  }

  // BACKUP ("DO NOT USE"): MCP get_dy_knowledge — stateless, solo red corporativa.
  if (provider === "mcp") {
    if (!isMcpReachableEnv()) {
      return NextResponse.json({ error: MCP_UNREACHABLE_MSG }, { status: 503 });
    }
    try {
      const r = await generateStateless("mcp", { question, mode, structured, context });
      return NextResponse.json({
        ok: true,
        answer: r.answer,
        expert: r.expert,
        tools: r.sourcesText || "get_dy_knowledge",
        threadId: "",
      });
    } catch (err) {
      const status = err instanceof McpError ? err.status ?? 502 : 500;
      return NextResponse.json({ error: (err as Error).message }, { status });
    }
  }

  // BACKUP ("DO NOT USE"): Experience OS Agent (threaded, con rotación de secciones).
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
