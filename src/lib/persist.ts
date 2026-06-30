import { prisma } from "./db";
import type { DyMessage } from "./dyClient";
import { stripTemplate } from "./promptTemplate";

/** Upsert de mensajes de DY en la BD local, asociados a un thread. */
export async function persistMessages(threadId: string, messages: DyMessage[]) {
  for (const m of messages) {
    const meta = {
      agentMetadata: m.agentMetadata,
      artifactMetadata: m.artifactMetadata,
      interactionId: m.interactionId,
    };
    // El mensaje humano que DY persiste incluye la plantilla de formato; la
    // quitamos para mostrar/guardar la pregunta limpia.
    const text = m.role === "human" ? stripTemplate(m.text) : m.text;
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
