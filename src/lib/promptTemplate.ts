/**
 * Plantilla de respuesta estructurada para el agente de DY.
 *
 * Hay tres estilos de respuesta:
 *   - "simple"   → sin plantilla: respuesta corta y directa, sin referencias.
 *   - "detailed" → prosa: 1 párrafo high-level + 3-4 párrafos de desarrollo +
 *                  un ejemplo concreto + referencias finales (URLs).
 *   - "bulleted" → misma idea pero el desarrollo va en bullet points; también
 *                  con ejemplo y referencias finales (URLs).
 *
 * El bloque de instrucciones va delimitado por marcadores para poder
 * eliminarlo del mensaje humano que se muestra/guarda (ver stripTemplate).
 */

export type AnswerMode = "simple" | "detailed" | "bulleted";

export const FORMAT_START = "[ANSWER FORMAT]";
export const FORMAT_END = "[/ANSWER FORMAT]";

const DETAILED_INSTRUCTIONS = `You MUST format your entire answer using the EXACT section structure below, in this order, using Markdown headers — even if the answer is short or you have limited information. Never reply with a single plain paragraph.

## Summary
A single, high-level paragraph that answers the question directly. Be positive and constructive wherever it is reasonable to be.

## Details
Develop the answer in 3 to 4 flowing paragraphs (no bullet points). If information is limited, still write at least one substantial paragraph here — never leave it empty or collapse everything into the Summary. Explain the reasoning in depth: how it works / how it is done, why it matters, and what it achieves (the value or benefit). Each paragraph should build on the previous one rather than repeating it.

## Example
Give one concrete, practical example that illustrates the answer in a real scenario.

## References
List the supporting sources as Markdown links with the full URLs to the relevant articles or documentation (e.g. - [Title](https://...)). Always include the URLs. If you genuinely have no sources, write "No specific references available.".`;

const BULLETED_INSTRUCTIONS = `You MUST format your entire answer using the EXACT section structure below, in this order, using Markdown headers — even if the answer is short or you have limited information. Never reply with a single plain paragraph.

## Summary
A single, high-level paragraph that answers the question directly. Be positive and constructive wherever it is reasonable to be.

## Details
ALWAYS use Markdown bullet points here (lines starting with "- "). Never write this section as prose paragraphs. Provide at least 3 bullets; if information is limited, still split what you know into separate bullets. Each bullet covers one key idea — how it works / how it is done, why it matters, or what it achieves (the value or benefit). Use concise, substantial bullets and sub-bullets where helpful.

## Example
Give one concrete, practical example that illustrates the answer in a real scenario.

## References
List the supporting sources as Markdown links with the full URLs to the relevant articles or documentation (e.g. - [Title](https://...)). Always include the URLs. If you genuinely have no sources, write "No specific references available.".`;

/** Activa/desactiva la plantilla vía env (por defecto: activada). */
export function isTemplateEnabled(): boolean {
  return (process.env.DY_STRUCTURED_ANSWERS ?? "true").toLowerCase() !== "false";
}

/** Normaliza distintas entradas (mode string o structured boolean) a AnswerMode. */
export function resolveMode(input: {
  mode?: string;
  structured?: boolean;
}): AnswerMode {
  if (
    input.mode === "detailed" ||
    input.mode === "bulleted" ||
    input.mode === "simple"
  ) {
    return input.mode;
  }
  // Compatibilidad: structured=true → detailed, false/omitido → simple.
  return input.structured ? "detailed" : "simple";
}

/** Envuelve la pregunta con las instrucciones de formato del modo elegido. */
export function wrapWithTemplate(question: string, mode: AnswerMode): string {
  if (mode === "simple") return question.trim();
  const instructions =
    mode === "bulleted" ? BULLETED_INSTRUCTIONS : DETAILED_INSTRUCTIONS;
  return `${FORMAT_START}\n${instructions}\n${FORMAT_END}\n\nQuestion: ${question.trim()}`;
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
