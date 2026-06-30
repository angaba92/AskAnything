import { NextRequest, NextResponse } from "next/server";
import {
  askCopilot,
  isCopilotConfigured,
  CopilotConfigError,
  CopilotAuthError,
} from "@/lib/copilotClient";

export const dynamic = "force-dynamic";

/**
 * POST /api/copilot  { question, webSearch? }
 * Pregunta a Microsoft 365 Copilot (Graph Chat API) y devuelve la respuesta.
 */
export async function POST(req: NextRequest) {
  if (!isCopilotConfigured()) {
    return NextResponse.json(
      { error: "Copilot no configurado (faltan AZURE_TENANT_ID / AZURE_CLIENT_ID)." },
      { status: 503 }
    );
  }

  const { question, webSearch } = (await req.json()) as {
    question: string;
    webSearch?: boolean;
  };
  if (!question?.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  try {
    const { answer } = await askCopilot(question.trim(), { webSearch });
    return NextResponse.json({ ok: true, answer });
  } catch (err) {
    if (err instanceof CopilotConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof CopilotAuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
