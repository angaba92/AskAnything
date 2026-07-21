import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendMessageWithRetry, getThread, DyAuthError, type DyMessage } from "@/lib/dyClient";
import { persistMessages } from "@/lib/persist";
import { resolveMode } from "@/lib/promptTemplate";
import { generateStateless, resolveProvider, isStateless } from "@/lib/providers";
import { KaError } from "@/lib/kaClient";
import { McpError, isMcpReachableEnv, MCP_UNREACHABLE_MSG } from "@/lib/mcpClient";

export const dynamic = "force-dynamic";

/**
 * POST /api/chat  { threadId, message, mode?, backend? }
 * Persiste el mensaje humano, lo envía al backend elegido (agente DY o MCP),
 * persiste la respuesta y la devuelve.
 */
export async function POST(req: NextRequest) {
  const { threadId, message, structured, mode, backend } = (await req.json()) as {
    threadId: string;
    message: string;
    structured?: boolean;
    mode?: string;
    backend?: string;
  };

  if (!threadId || !message?.trim()) {
    return NextResponse.json(
      { error: "threadId and message are required" },
      { status: 400 }
    );
  }

  // Aseguramos que el thread exista localmente y le damos título si aún es el por defecto.
  const existing = await prisma.thread.findUnique({ where: { id: threadId } });
  await prisma.thread.upsert({
    where: { id: threadId },
    create: { id: threadId, title: message.slice(0, 60) },
    update:
      !existing || existing.title === "New conversation"
        ? { title: message.slice(0, 60) }
        : {},
  });

  // MIGRACIÓN: proveedor por defecto "ka" (DY Knowledge Assistant). Los
  // proveedores stateless (KA por defecto; MCP como backup "DO NOT USE") NO usan
  // el hilo de DY: persistimos localmente el par pregunta/respuesta con seqIds
  // correlativos, de forma que el historial del chat se mantiene igual que antes.
  const provider = resolveProvider(backend);
  if (isStateless(provider)) {
    if (provider === "mcp" && !isMcpReachableEnv()) {
      return NextResponse.json({ error: MCP_UNREACHABLE_MSG }, { status: 503 });
    }
    try {
      const r = await generateStateless(provider, { question: message, mode, structured });
      const agg = await prisma.message.aggregate({
        where: { threadId },
        _max: { seqId: true },
      });
      const base = (agg._max.seqId ?? 0) + 1;
      const stamp = Date.now();
      const tool = provider === "ka" ? "knowledge_assistant" : "get_dy_knowledge";
      const msgs: DyMessage[] = [
        { id: `${provider}-h-${stamp}`, role: "human", text: message, seqId: base },
        {
          id: `${provider}-a-${stamp}`,
          role: "ai",
          text: r.answer,
          seqId: base + 1,
          agentMetadata: { toolsUsed: [tool], expertSelected: r.expert },
        },
      ];
      // La respuesta ya viene formateada; persistMessages sólo la pasa a texto
      // plano (idempotente). No forzamos bullets de nuevo (ya se aplicaron).
      await persistMessages(threadId, msgs);
      return NextResponse.json({ ok: true, messages: msgs });
    } catch (err) {
      const status =
        err instanceof KaError || err instanceof McpError ? err.status ?? 502 : 500;
      return NextResponse.json({ error: (err as Error).message }, { status });
    }
  }

  try {
    // Enviamos a DY con el estilo elegido (simple / detailed / bulleted) y con
    // la MISMA sección con la que se creó el thread (para no colisionar con el
    // batch ni con otras conversaciones).
    const dy = await sendMessageWithRetry(threadId, message, {
      structured: structured !== false,
      mode,
      sectionId: existing?.section ?? undefined,
    });
    // En modo viñetas, forzamos el formato solo sobre las respuestas del agente
    // recién generadas (no sobre el historial que se reconcilia después).
    const bulletedAiIds =
      resolveMode({ mode, structured }) === "bulleted"
        ? dy.messages.filter((m) => m.role !== "human").map((m) => m.id)
        : [];
    await persistMessages(threadId, dy.messages, { bulletedAiIds });
    // ...y reconciliamos con el historial autoritativo (incluye el mensaje
    // humano con su id/seqId reales, evitando duplicados). Los ids de DY aquí
    // pueden diferir de los de la respuesta directa, así que para forzar las
    // viñetas apuntamos a la respuesta IA más reciente por seqId.
    const full = await getThread(threadId);
    let reconcileBulleted: string[] = [];
    if (resolveMode({ mode, structured }) === "bulleted") {
      const latestAi = full.messages
        .filter((m) => m.role !== "human")
        .sort((a, b) => (b.seqId ?? 0) - (a.seqId ?? 0))[0];
      if (latestAi) reconcileBulleted = [latestAi.id];
    }
    await persistMessages(threadId, full.messages, {
      bulletedAiIds: reconcileBulleted,
    });
    return NextResponse.json({ ok: true, messages: dy.messages });
  } catch (err) {
    if (err instanceof DyAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
