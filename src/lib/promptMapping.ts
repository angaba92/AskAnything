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
import { instructionsFor } from "./promptTemplate";
import {
  CLIENT_FACING_RFP_POLICY,
  CLIENT_ANSWER_FRAME_INSTRUCTION,
  CONFIDENCE_REVIEW_INSTRUCTION,
  clientFacingFallback,
  extractConfidenceReview,
  hasNonClientFacingLanguage,
  isClarificationRequest,
  separateReviewLimitations,
  stripNonClientFacingPreamble,
  stripNonClientFacingPassages,
  stripNonClientFacingSentences,
  extractConfidenceNote,
  extractSourceUrls,
  isInternalSourceUrl,
  stripInternalSourceLinks,
} from "./responsePolicy";

export type { AnswerMode };
/** Límite solicitado para el archivo; KA aplica su límite al payload completo. */
export const MAX_CUSTOM_PROMPT_CHARS = 8000;
export {
  clientFacingFallback,
  extractConfidenceReview,
  hasNonClientFacingLanguage,
  isClarificationRequest,
  separateReviewLimitations,
  stripNonClientFacingPreamble,
  stripNonClientFacingPassages,
  stripNonClientFacingSentences,
  extractConfidenceNote,
  extractSourceUrls,
  isInternalSourceUrl,
  stripInternalSourceLinks,
};

/** Todos los modos disponibles, en el orden en que se muestran en la UI. */
export type VisibleAnswerMode = Exclude<AnswerMode, "bulleted">;

export const ANSWER_MODES: VisibleAnswerMode[] = [
  "detailed",
  "loopio",
  "simple",
  "custom",
];

/** Etiqueta corta de cada modo (botón del selector de estilo). */
export const MODE_LABELS: Record<AnswerMode, string> = {
  detailed: "Detailed",
  bulleted: "Detailed (bullets)",
  loopio: "Loopio (RFP)",
  simple: "Simple",
  custom: "Custom",
};

/** Pista descriptiva de cada modo (texto auxiliar junto al selector). */
export const MODE_HINTS: Record<AnswerMode, string> = {
  detailed: "Summary · Details · Example · References",
  bulleted: "Summary · bullet Details · Example · References",
  loopio: "Verdict · themed sections · example · source (RFP style)",
  simple: "Short, direct answer",
  custom: "Uses your uploaded .md instructions instead of built-in guardrails",
};

/**
 * Instrucción de estilo por modo para el KA. Son versiones concisas y
 * verificadas contra el endpoint real de producción: el modelo (Claude en
 * Bedrock) las respeta y produce el mismo estilo que el resto de la app. La
 * normalización final (quitar markdown, forzar viñetas) la hace plainifyAnswer /
 * enforceBullets, así que aquí basta con describir la forma deseada.
 */
const KA_STYLE_INSTRUCTIONS: Record<AnswerMode, string | null> = {
  // "simple" no lleva estructura: prosa breve y directa (ideal para celdas), pero
  // la exactitud y la cobertura de la pregunta mandan sobre la brevedad.
  simple:
    'Answer in concise plain prose with no headings, bullets, or Markdown. Aim for 2-4 sentences, but completeness and accuracy always take priority over brevity: include every material fact, number, endpoint, condition, and qualifier needed for the answer to be correct, and cover every part of a multi-part question. Never drop, round, or approximate a figure just to stay short, and never omit a relevant capability. Finish with a final line starting "Sources: " with the full supporting URL(s) separated by "; ". Omit the Sources line only if no URL is available.',
  detailed:
    'Answer in plain prose (no markdown headings, no bullet points). Start with one paragraph that answers directly, then 3-4 paragraphs of depth, then one paragraph with a concrete real-world example. Finish with a single line "Sources: " listing the full URL(s) separated by "; " (omit the line if you have none).',
  bulleted:
    'Answer in plain text. Start with 1-2 sentences that answer directly. Then 4-7 bullets, each on its own line starting with "\u2022 " and self-contained (a couple of sentences is fine). Then a short paragraph starting "As an example, ". Finish with a single line "Sources: " listing the full URL(s) separated by "; " (omit the line if you have none).',
  loopio: instructionsFor("loopio"),
  custom: null,
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
  opts: {
    mode: AnswerMode;
    context?: string;
    confidenceReview?: boolean;
    customPrompt?: string;
  } = {
    mode: "detailed",
  }
): string {
  const context = opts.context?.trim()
    ? `\n\nSupporting context:\n${opts.context.trim()}`
    : "";
  const instruction = kaStyleInstruction(opts.mode);
  const q = question.trim();
  const style = instruction ? `\n\n${instruction}` : "";
  // La política va AL FINAL para darle máxima prioridad por recencia, en todos
  // los modos. Así el KA no expone búsquedas, gaps documentales ni equipos internos.
  const confidence = opts.confidenceReview
    ? `\n\n${CONFIDENCE_REVIEW_INSTRUCTION}`
    : "";
  if (opts.mode === "custom") {
    const customPrompt = opts.customPrompt?.trim();
    if (!customPrompt) {
      throw new Error("Custom mode requires an uploaded .md prompt.");
    }
    if (customPrompt.length > MAX_CUSTOM_PROMPT_CHARS) {
      throw new Error(
        `Custom prompt is too long (${customPrompt.length.toLocaleString()} characters). Maximum: ${MAX_CUSTOM_PROMPT_CHARS.toLocaleString()}.`,
      );
    }
    // Custom sustituye ABSOLUTAMENTE toda nuestra capa: tampoco añadimos metadata
    // de confianza, que ocupaba ~1K y hacía fallar prompts cercanos a 8K.
    return `Question:\n${q}${context}\n\n${customPrompt}`;
  }
  const outputContract = opts.mode === "loopio"
    ? "\n\nFINAL OUTPUT CHECK: Return the customer answer directly, without an introduction about writing it. Include the opening, themed bullet sections and a supported practical example. A one-sentence product description is NOT a completed Loopio response. Cover supported aspects even when an exact figure is unknown. Put only the missing specifics in the final CONFIDENCE_REVIEW line."
    : "";
  const boundary = opts.mode === "loopio" ? `\n\n${CLIENT_ANSWER_FRAME_INSTRUCTION}` : "";
  const content = `Question:\n${q}${context}${style}\n\n${CLIENT_FACING_RFP_POLICY}${confidence}${outputContract}${boundary}`;
  if (content.length > 8000) {
    throw new Error(`The full Knowledge Assistant prompt is ${content.length} characters; its limit is 8000. Shorten the question or supporting context before retrying.`);
  }
  return content;
}
