/**
 * Reparto de secciones de Dynamic Yield.
 *
 * DY resuelve el "thread" (conversación) a partir del header `dy_section_id`, y
 * devuelve UN único thread por sección dentro de una ventana de ~2h (limitación
 * de su lado: acumula todos los mensajes en la ventana de contexto del LLM). Con
 * una sola cookie de equipo, TODOS los usuarios colisionan en el mismo thread si
 * comparten sección.
 *
 * Para evitarlo separamos dos pools que NUNCA se solapan:
 *   - BATCH_SECTIONS: las usa el llenado masivo de Excel (rota entre ellas para
 *     repartir la memoria y no saturar un único thread).
 *   - CHAT_SECTIONS: las usa el chat en vivo. Cada conversación nueva coge la
 *     siguiente sección (rotación), de modo que dos usuarios —o dos "New"—
 *     caen en threads distintos e independientes, y nunca chocan con el batch.
 */

export const BATCH_SECTIONS = ["8787656", "8775500", "8794611"];

export const CHAT_SECTIONS = [
  "8768867",
  "8787829",
  "8783088",
  "8769003",
  "8783152",
  "8787856",
];

import { prisma } from "./db";

const CURSOR_KEY = "chat_section_cursor";

/**
 * Devuelve la siguiente sección del pool de chat, rotando con un cursor
 * persistido en la BD (Setting) para que cada "New conversation" —aunque venga
 * de distintos usuarios/instancias serverless— use una sección diferente.
 * Si la BD no está disponible, cae a una elección aleatoria.
 */
export async function nextChatSection(): Promise<string> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: CURSOR_KEY } });
    const cur = row ? parseInt(row.value, 10) || 0 : 0;
    const section = CHAT_SECTIONS[cur % CHAT_SECTIONS.length];
    const next = String((cur + 1) % CHAT_SECTIONS.length);
    await prisma.setting.upsert({
      where: { key: CURSOR_KEY },
      create: { key: CURSOR_KEY, value: next },
      update: { value: next },
    });
    return section;
  } catch {
    return CHAT_SECTIONS[Math.floor(Math.random() * CHAT_SECTIONS.length)];
  }
}
