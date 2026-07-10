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

const DETAILED_INSTRUCTIONS = `Write the answer in PLAIN TEXT only. Do NOT use Markdown of any kind: no "#" headings, no "**" or "*" for bold/italic, no bullet dashes, and no section titles like "Summary", "Details", "Example" or "References".

Begin with one clear paragraph that answers the question directly and positively. Then add 3 to 4 well-developed paragraphs that explain in depth how it works, why it matters, and the value or benefit it delivers, followed by one paragraph with a concrete, real-world example. Be thorough and comprehensive — this is the long, detailed format. Keep everything as flowing, natural prose (no bullet points).

If you have supporting documentation, finish with a single final line that starts with "Sources: " followed by the full URL(s), separated by "; ". If you genuinely have no sources, omit that line entirely.`;

const BULLETED_INSTRUCTIONS = `Write the answer in PLAIN TEXT only. Do NOT use Markdown of any kind: no "#" headings, no "**" or "*" for bold/italic, and no section titles like "Summary", "Details", "Example" or "References".

Begin with a short intro that answers the question directly and positively — as long as it needs to be to actually address the question. Then add up to 5 bullet points (fewer is fine), each on its own line starting with "• " (a real bullet character, not a dash or asterisk). Each bullet must be concise but complete — one clear idea, not too long, no sub-bullets. After the bullets, add one line with a quick concrete example starting with "Example: ".

If you have supporting documentation, finish with a single final line that starts with "Sources: " followed by the full URL(s), separated by "; ". If you genuinely have no sources, omit that line entirely.`;

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

/** Envuelve la pregunta con las instrucciones de formato del modo elegido.
 * Las instrucciones van AL FINAL (justo tras la pregunta): por recencia, el
 * agente les da mucho más peso que al historial del hilo, que es lo que hacía
 * que a veces se saltara el formato al rotar entre secciones con historiales
 * distintos. */
export function wrapWithTemplate(question: string, mode: AnswerMode): string {
  if (mode === "simple") return question.trim();
  const instructions =
    mode === "bulleted" ? BULLETED_INSTRUCTIONS : DETAILED_INSTRUCTIONS;
  return `${question.trim()}\n\n${FORMAT_START}\n${instructions}\n${FORMAT_END}`;
}

/**
 * Quita el bloque de instrucciones (y el prefijo "Question:") de un texto,
 * para que el mensaje humano se muestre/guarde limpio aunque DY lo persista
 * con la plantilla incluida.
 */
export function stripTemplate(text: string): string {
  // El bloque de formato puede ir al inicio o al final del mensaje.
  const re = /\s*\[ANSWER FORMAT\][\s\S]*?\[\/ANSWER FORMAT\]\s*/i;
  let t = text.replace(re, "");
  t = t.replace(/^Question:\s*/i, "");
  return t.trim();
}

/**
 * Convierte una respuesta con Markdown a texto plano apto para una celda de
 * Excel: quita cabeceras (## …), negritas/cursivas, transforma enlaces
 * [txt](url) en "txt (url)", normaliza viñetas a "• " y elimina las líneas que
 * son solo un rótulo de sección (Summary/Details/Example/References). Es una red
 * de seguridad por si el agente ignora la instrucción de "texto plano".
 */
export function plainifyAnswer(text: string): string {
  let t = text ?? "";
  // Enlaces Markdown [label](url) -> "label (url)".
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)");
  // Negritas/cursivas.
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1");
  t = t.replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, "$1$2");

  const dropLabel =
    /^(summary|details|example|examples|references|sources?|fuentes?)\s*:?\s*$/i;
  const lines = t.split(/\r?\n/).map((line) => {
    const h = line.match(/^\s{0,3}#{1,6}\s*(.*)$/);
    if (h) {
      const label = h[1].trim();
      return dropLabel.test(label) ? null : label; // rótulo solo -> fuera
    }
    // Viñetas Markdown (-, *, +) -> "• ".
    return line.replace(/^(\s{0,3})[-*+]\s+/, "$1• ");
  });

  return lines
    .filter((l) => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Garantía determinista para el modo "bulleted": si el agente ignoró el formato
 * y devolvió prosa, la convertimos nosotros a viñetas (una frase por bullet),
 * dejando la primera frase como intro y respetando una línea final "Sources:".
 * Si ya trae viñetas ("• "), no toca nada. Así, cuando el usuario elige
 * bulleted, SIEMPRE recibe viñetas, sin depender de si el LLM cumplió.
 */
export function enforceBullets(text: string): string {
  const t = (text ?? "").trim();
  if (!t) return t;
  const rawLines = t.split(/\r?\n/);
  // ¿Ya hay viñetas? Entonces el agente cumplió: no tocamos nada.
  if (rawLines.some((l) => /^\s*•\s+/.test(l))) return t;

  // Separamos una posible sección final de fuentes (esté en su propia línea o
  // inline), ANTES de trocear en frases, para que las URLs no se partan.
  let sources = "";
  let work = t;
  const sm = work.match(/(?:^|\n|\s)(?:sources?|fuentes?)\s*:\s*([\s\S]+?)\s*$/i);
  if (sm && sm.index !== undefined) {
    sources = "Sources: " + sm[1].replace(/\s+/g, " ").trim();
    work = work.slice(0, sm.index).trim();
  }

  const prose = work.replace(/\s+/g, " ").trim();
  if (!prose) return sources || t;

  // Partimos en frases (respetando el punto final). El lookahead exige espacio
  // o fin tras el signo, así una URL como "dy.dev" no se corta.
  const sentences =
    prose.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ??
    [prose];

  const parts: string[] = [];
  if (sentences.length <= 1) {
    parts.push("• " + sentences[0]);
  } else {
    parts.push(sentences[0]); // intro
    for (const s of sentences.slice(1)) parts.push("• " + s);
  }
  if (sources) parts.push(sources);
  return parts.join("\n");
}
