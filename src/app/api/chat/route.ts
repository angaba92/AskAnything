import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendMessageWithRetry, getThread, DyAuthError } from "@/lib/dyClient";
import { persistMessages } from "@/lib/persist";
import { resolveMode } from "@/lib/promptTemplate";

export const dynamic = "force-dynamic";

/**
 * POST /api/chat  { threadId, message }
 * Persiste el mensaje humano, lo envía a DY, persiste la respuesta y la devuelve.
 */
export async function POST(req: NextRequest) {
  const { threadId, message, structured, mode } = (await req.json()) as {
    threadId: string;
    message: string;
    structured?: boolean;
    mode?: string;
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
