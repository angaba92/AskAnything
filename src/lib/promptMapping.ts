/**
 * CAPA DE MAPEO DE PROMPTS (configuración centralizada).
 *
 * Fuente ÚNICA de verdad para:
 *   1. Las instrucciones de estilo que se envían a la nueva plataforma (KA) por
 *      cada modo de respuesta.
 *   2. Las etiquetas y descripciones que la UI muestra para cada modo.
 *
 * Objetivo de la migración: NO repartir texto de prompt por componentes/rutas.
 * Cualquier ajuste de estilo o de copy se hace aquí.
 *
 * El KA expone UN ÚNICO system prompt (no varios prompts con nombre), y su salida
 * se adapta según la pregunta. Para conservar los 4 estilos de AskAnything sin
 * mutar ese prompt global compartido, inyectamos la instrucción de estilo en el
 * propio mensaje del usuario (el modelo respeta la instrucción más reciente).
 */

import type { AnswerMode } from "./promptTemplate";

export type { AnswerMode };

/** Todos los modos disponibles, en el orden en que se muestran en la UI. */
export const ANSWER_MODES: AnswerMode[] = [
  "detailed",
  "bulleted",
  "loopio",
  "simple",
];

/** Etiqueta corta de cada modo (botón del selector de estilo). */
export const MODE_LABELS: Record<AnswerMode, string> = {
  detailed: "Detailed",
  bulleted: "Detailed (bullets)",
  loopio: "Loopio (RFP)",
  simple: "Simple",
};

/** Pista descriptiva de cada modo (texto auxiliar junto al selector). */
export const MODE_HINTS: Record<AnswerMode, string> = {
  detailed: "Summary · Details · Example · References",
  bulleted: "Summary · bullet Details · Example · References",
  loopio: "Verdict · themed sections · example · source (RFP style)",
  simple: "Short, direct answer",
};

/**
 * Instrucción de estilo por modo para el KA. Son versiones concisas y
 * verificadas contra el endpoint real de producción: el modelo (Claude en
 * Bedrock) las respeta y produce el mismo estilo que el resto de la app. La
 * normalización final (quitar markdown, forzar viñetas) la hace plainifyAnswer /
 * enforceBullets, así que aquí basta con describir la forma deseada.
 */
const KA_STYLE_INSTRUCTIONS: Record<AnswerMode, string | null> = {
  // "simple" no lleva estructura: prosa breve y directa (ideal para celdas).
  simple:
    'Answer ONLY in 1-2 plain sentences. No headings, no markdown, no bullet points, no "Sources" section.',
  detailed:
    'Answer in plain prose (no markdown headings, no bullet points). Start with one paragraph that answers directly, then 3-4 paragraphs of depth, then one paragraph with a concrete real-world example. Finish with a single line "Sources: " listing the full URL(s) separated by "; " (omit the line if you have none).',
  bulleted:
    'Answer in plain text. Start with 1-2 sentences that answer directly. Then 4-7 bullets, each on its own line starting with "\u2022 " and self-contained (a couple of sentences is fine). Then a short paragraph starting "As an example, ". Finish with a single line "Sources: " listing the full URL(s) separated by "; " (omit the line if you have none).',
  loopio:
    'Answer in RFP style, plain text, using "\u2022 " for bullets. 1) A one-sentence verdict starting with "Yes." or "No." or "Partially." then "Mastercard Dynamic Yield " and the essence. 2) One or more short themed sections: each a 2-4 word Title Case heading on its own line (no colon, no markdown), followed by "\u2022 " bullets. 3) A paragraph starting "For example, ". 4) A closing line starting "For more information, please refer to our " with the resource name and its full URL in parentheses (omit if you have none).',
};

/** Devuelve la instrucción de estilo del KA para un modo (null en "simple"
 * cuando no se quiere forzar nada extra — aquí sí la damos para acotar longitud). */
export function kaStyleInstruction(mode: AnswerMode): string | null {
  return KA_STYLE_INSTRUCTIONS[mode] ?? null;
}

/**
 * Construye el `content` del mensaje de usuario para el KA: contexto opcional de
 * empresa/industria + la pregunta + la instrucción de estilo del modo.
 */
export function buildKaUserContent(
  question: string,
  opts: { mode: AnswerMode; context?: string } = { mode: "detailed" }
): string {
  const context = opts.context?.trim() ? `${opts.context.trim()}\n\n` : "";
  const instruction = kaStyleInstruction(opts.mode);
  const q = question.trim();
  return instruction ? `${context}${q}\n\n${instruction}` : `${context}${q}`;
}
