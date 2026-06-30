/**
 * Plantilla de respuesta estructurada para el agente de DY.
 *
 * Envolvemos la pregunta del usuario con instrucciones de formato para que el
 * agente devuelva SIEMPRE la misma estructura de tres secciones:
 *   1) Summary  — respuesta high level, positiva dentro de lo posible.
 *   2) Details  — desarrollo con puntos clave, cómo se hace, qué se consigue,
 *                 algún ejemplo.
 *   3) References — enlaces a los artículos / documentación de apoyo.
 *
 * El bloque de instrucciones va delimitado por marcadores para poder
 * eliminarlo del mensaje humano que se muestra/guarda (ver stripTemplate).
 */

export const FORMAT_START = "[ANSWER FORMAT]";
export const FORMAT_END = "[/ANSWER FORMAT]";

const INSTRUCTIONS = `Structure your answer in EXACTLY these three Markdown sections, in this order:

## Summary
A concise, high-level answer in 1-3 sentences. Be positive and constructive wherever it is reasonable to be.

## Details
Develop the answer in depth using flowing, well-structured paragraphs that explain the reasoning: how it works / how it is done, why it matters, and what it achieves (the value or benefit). Expand on the key ideas rather than just listing them, and include at least one concrete example when relevant. Avoid bullet points — only use a short list if a set of truly parallel items genuinely cannot be expressed well in prose.

## References
List the supporting sources as Markdown links to the relevant articles or documentation. If you genuinely have no sources, write "No specific references available.".`;

/** Activa/desactiva la plantilla vía env (por defecto: activada). */
export function isTemplateEnabled(): boolean {
  return (process.env.DY_STRUCTURED_ANSWERS ?? "true").toLowerCase() !== "false";
}

/** Envuelve la pregunta con las instrucciones de formato. */
export function wrapWithTemplate(question: string): string {
  return `${FORMAT_START}\n${INSTRUCTIONS}\n${FORMAT_END}\n\nQuestion: ${question.trim()}`;
}

/**
 * Quita el bloque de instrucciones (y el prefijo "Question:") de un texto,
 * para que el mensaje humano se muestre/guarde limpio aunque DY lo persista
 * con la plantilla incluida.
 */
export function stripTemplate(text: string): string {
  const re = /^\s*\[ANSWER FORMAT\][\s\S]*?\[\/ANSWER FORMAT\]\s*/i;
  let t = text.replace(re, "");
  t = t.replace(/^Question:\s*/i, "");
  return t.trim();
}
