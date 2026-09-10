import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { DyMessage } from "@/lib/dyClient";
import { persistMessages } from "@/lib/persist";
import { generateStateless } from "@/lib/providers";
import { normalizeBridgedKaResponse } from "@/lib/providers/ka";
import { KaError } from "@/lib/kaClient";
import { MAX_CUSTOM_PROMPT_CHARS } from "@/lib/promptMapping";
import { requestUser } from "@/lib/requestUser";

export const dynamic = "force-dynamic";

/**
 * Persists a local conversation and normalizes a Knowledge Assistant response.
 * There is intentionally no selectable backend or Experience OS Agent fallback.
 */
export async function POST(req: NextRequest) {
  const { threadId, message, structured, mode, customPrompt, localKaResponse } = (await req.json()) as {
    threadId: string;
    message: string;
    structured?: boolean;
    mode?: string;
    customPrompt?: string;
    localKaResponse?: string;
  };

  if (!threadId || !message?.trim()) {
    return NextResponse.json(
      { error: "threadId and message are required" },
      { status: 400 }
    );
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

  // Aseguramos que el thread exista localmente y le damos título si aún es el por defecto.
  const owner = requestUser(req);
  const existing = await prisma.thread.findFirst({
    where: { id: threadId, owner },
  });
  if (!existing) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  if (existing.title === "New conversation") {
    await prisma.thread.update({
      where: { id: threadId },
      data: { title: message.slice(0, 60) },
    });
  }

  try {
    const generateOpts = {
      question: message,
      mode,
      structured,
      customPrompt,
    };
    const response = localKaResponse
      ? normalizeBridgedKaResponse(localKaResponse, generateOpts)
      : await generateStateless("ka", generateOpts);
    const aggregate = await prisma.message.aggregate({
      where: { threadId },
      _max: { seqId: true },
    });
    const base = (aggregate._max.seqId ?? 0) + 1;
    const stamp = Date.now();
    const messages: DyMessage[] = [
      { id: `ka-h-${stamp}`, role: "human", text: message, seqId: base },
      {
        id: `ka-a-${stamp}`,
        role: "ai",
        text: response.answer,
        seqId: base + 1,
        agentMetadata: {
          toolsUsed: ["knowledge_assistant"],
          expertSelected: response.expert,
        },
      },
    ];
    await persistMessages(threadId, messages);
    return NextResponse.json({ ok: true, messages });
  } catch (err) {
    const status = err instanceof KaError ? err.status ?? 502 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
