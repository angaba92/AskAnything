import { prisma } from "./db";
import type { DyMessage } from "./dyClient";
import { stripTemplate, plainifyAnswer, enforceBullets } from "./promptTemplate";

/** Upsert de mensajes de DY en la BD local, asociados a un thread.
 *
 * `bulletedAiIds` (opcional): ids de mensajes del agente a los que además de
 * limpiar el markdown hay que forzarles el formato de viñetas. Solo se aplica a
 * esos ids concretos (los recién generados en modo "bulleted"), nunca a todo el
 * historial, para no reescribir respuestas antiguas en otro estilo. */
export async function persistMessages(
  threadId: string,
  messages: DyMessage[],
  opts: { bulletedAiIds?: string[] } = {}
) {
  const bulleted = new Set(opts.bulletedAiIds ?? []);
  for (const m of messages) {
    const meta = {
      agentMetadata: m.agentMetadata,
      artifactMetadata: m.artifactMetadata,
      interactionId: m.interactionId,
    };
    // El mensaje humano que DY persiste incluye la plantilla de formato; la
    // quitamos para mostrar/guardar la pregunta limpia. Las respuestas del
    // agente se pasan a texto plano (sin markdown) y, si son del envío actual
    // en modo viñetas, se les fuerza el formato de bullets.
    let text: string;
    if (m.role === "human") {
      text = stripTemplate(m.text);
    } else {
      text = plainifyAnswer(m.text);
      if (bulleted.has(m.id)) text = enforceBullets(text);
    }
    await prisma.message.upsert({
      where: { id: m.id },
      create: {
        id: m.id,
        threadId,
        role: m.role,
        text,
        seqId: m.seqId ?? 0,
        meta: JSON.stringify(meta),
        createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
      },
      update: {
        text,
        seqId: m.seqId ?? 0,
        meta: JSON.stringify(meta),
      },
    });
  }
  if (messages.length > 0) {
    await prisma.thread.update({
      where: { id: threadId },
      data: { updatedAt: new Date() },
    });
  }
}

/** Deriva un título legible a partir del primer mensaje humano (por seqId). */
export function deriveTitle(messages: DyMessage[]): string | undefined {
  const humans = messages
    .filter((m) => m.role === "human")
    .sort((a, b) => (a.seqId ?? 0) - (b.seqId ?? 0));
  if (humans.length === 0) return undefined;
  return stripTemplate(humans[0].text).slice(0, 60);
}
