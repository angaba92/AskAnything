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

export type AnswerMode =
  | "simple"
  | "detailed"
  | "bulleted" // legacy compatibility; no longer exposed in the UI
  | "loopio"
  | "custom";

export const FORMAT_START = "[ANSWER FORMAT]";
export const FORMAT_END = "[/ANSWER FORMAT]";

const DETAILED_INSTRUCTIONS = `Write the answer in PLAIN TEXT only. Do NOT use Markdown of any kind: no "#" headings, no "**" or "*" for bold/italic, no bullet dashes, and no section titles like "Summary", "Details", "Example" or "References".

Begin with one clear paragraph that answers the question directly and positively. Then add 3 to 4 well-developed paragraphs that explain in depth how it works, why it matters, and the value or benefit it delivers, followed by one paragraph with a concrete, real-world example. Be thorough and comprehensive — this is the long, detailed format. Keep everything as flowing, natural prose (no bullet points).

If you have supporting documentation, finish with a single final line that starts with "Sources: " followed by the full URL(s), separated by "; ". If you genuinely have no sources, omit that line entirely.`;

const BULLETED_INSTRUCTIONS = `Write the answer in PLAIN TEXT only. Do NOT use Markdown of any kind: no "#" headings, no "**" or "*" for bold/italic, and no section titles or labels like "High-Level Answer", "Summary", "Details", "How Dynamic Yield Does This", "Example", "Practical Example" or "References". Never print those labels.

Structure the answer exactly like this, with blank lines between the blocks:

First, one or two sentences that directly answer the question at a high level (a clear yes/no plus the essence).

Then a short lead-in sentence followed by a bullet list of the main points. Prefer FEWER but well-developed bullets over many short ones: aim for roughly 4 to 7 bullets, each a substantial, self-contained point that fully explains the idea (a couple of sentences is fine). Do not pad the list with trivial points; merge related ideas into one richer bullet. Each bullet goes on its own line starting with "• " (a real bullet character, not a dash or asterisk).

Then one short paragraph with a practical, real-world example. Introduce it naturally in the same sentence, starting with "As an example, " (do NOT put a label or heading before it).

If you have supporting documentation, finish with a single final line that starts with "Sources: " followed by the full URL(s), separated by "; ". If you genuinely have no sources, omit that line entirely.`;

const LOOPIO_INSTRUCTIONS = `Write the answer in PLAIN TEXT only (RFP/questionnaire style). Do NOT use Markdown: no "#", no "**"/"*" for bold/italic, no dashes for bullets. Use "• " (a real bullet character) for bullets.

Follow this exact structure, with a blank line between blocks:

1) Start with one positive, direct paragraph about supported Mastercard Dynamic Yield capabilities. Use "Yes." only when it naturally and fully answers a yes/no question; never force it. NEVER start with "No." or "Partially.". Move uncertainty or unsupported detail to the internal review signal rather than the client-facing answer.

2) One or more short THEMED sections. Each section begins with a very short heading of 2 to 4 words in plain text (Title case, NOT all caps, NO colon, NO markdown), on its own line — for example "Placement options", "Control", "Configuration", "Measurement and optimization". Under each heading, list its points as "• " bullets, each a complete, specific point. Use a SINGLE section for simple answers and MULTIPLE sections only when the answer has distinct themes. Group related points under the right heading instead of one long flat list.

3) One short paragraph introduced naturally with "For example, ".

4) A closing line that starts with "For more information, please refer to our " followed by the resource name and its full URL in parentheses, e.g. "For more information, please refer to our Recommendation Strategies article (https://support.dynamicyield.com/hc/en-us/articles/360022554694-Recommendation-Strategies)." You may cite more than one, joined with " and our ". If you genuinely have no source, omit this line.`;

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
    input.mode === "simple" ||
    input.mode === "loopio" ||
    input.mode === "custom"
  ) {
    return input.mode;
  }
  // Compatibilidad: structured=true → detailed, false/omitido → simple.
  return input.structured ? "detailed" : "simple";
}

/** Devuelve solo el bloque de instrucciones de un modo (sin marcadores). */
export function instructionsFor(mode: AnswerMode): string | null {
  if (mode === "simple" || mode === "custom") return null;
  return mode === "bulleted"
    ? BULLETED_INSTRUCTIONS
    : mode === "loopio"
    ? LOOPIO_INSTRUCTIONS
    : DETAILED_INSTRUCTIONS;
}

/** Envuelve la pregunta con las instrucciones de formato del modo elegido.
 * Las instrucciones van AL FINAL (justo tras la pregunta): por recencia, el
 * agente les da mucho más peso que al historial del hilo, que es lo que hacía
 * que a veces se saltara el formato al rotar entre secciones con historiales
 * distintos. */
export function wrapWithTemplate(question: string, mode: AnswerMode): string {
  const instructions = instructionsFor(mode);
  if (!instructions) return question.trim();
  return `${question.trim()}\n\n${FORMAT_START}\n${instructions}\n${FORMAT_END}`;
}

/** Como wrapWithTemplate pero SIN los marcadores [ANSWER FORMAT] …, para el
 * backend MCP (los corchetes/etiquetas a veces hacen fallar la tool). */
export function wrapForKnowledge(question: string, mode: AnswerMode): string {
  const instructions = instructionsFor(mode);
  if (!instructions) return question.trim();
  return `${question.trim()}\n\n${instructions}`;
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
  // Código inline/fences Markdown -> contenido plano.
  t = t
    .replace(/```(?:[A-Za-z0-9_-]+)?\s*\n?([\s\S]*?)```/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1");
  // Enlaces Markdown [label](url) -> "label (url)".
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)");
  // Negritas/cursivas.
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1");
  t = t.replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, "$1$2");

  const dropLabel =
    /^(answer|final answer|response|high[-\s]?level answer|how dynamic yield does this(,?\s*high[-\s]?level answer)?|practical example|summary|details?|overview|example|examples|references|sources?|fuentes?)\s*:?\s*$/i;
  const lines = t.split(/\r?\n/).map((line) => {
    // Separadores Markdown no aportan contenido y ensucian la celda de Excel.
    if (/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line)) return null;
    const h = line.match(/^\s{0,3}#{1,6}\s*(.*)$/);
    if (h) {
      const label = h[1].trim();
      return dropLabel.test(label) ? null : label; // rótulo solo -> fuera
    }
    // Rótulo de sección en texto plano (sin #) en su propia línea -> fuera.
    if (dropLabel.test(line.trim())) return null;
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
  const raw = (text ?? "").trim();
  if (!raw) return raw;

  // 1. Separamos una posible sección final de fuentes (en su propia línea o
  //    inline), ANTES de normalizar, para que las URLs no se toquen.
  let sources = "";
  let work = raw;
  const sm = work.match(/(?:^|\n|\s)(?:sources?|fuentes?)\s*:\s*([\s\S]+?)\s*$/i);
  if (sm && sm.index !== undefined) {
    sources = "Sources: " + sm[1].replace(/\s+/g, " ").trim();
    work = work.slice(0, sm.index).trim();
  }

  // 2. Normalizamos las viñetas SIN reordenar: guiones/asteriscos Markdown a
  //    "• ", y cada "•" (inline o duplicado) pasa a su propia línea. El resto
  //    del texto (intro, párrafo de ejemplo) mantiene su posición y sus saltos.
  const out = work
    .replace(/\r/g, "")
    .replace(/^[\t ]*[-*+]\s+/gm, "• ") // viñetas Markdown al inicio de línea
    .replace(/\s*•[\s•]*/g, "\n• ") // cada • -> nueva línea (colapsa dobles)
    .replace(/^\n+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const hasBullets = /(^|\n)•\s/.test(out);
  if (hasBullets) return sources ? `${out}\n${sources}` : out;

  // 3. Sin viñetas: el agente devolvió prosa -> la troceamos en frases (una por
  //    bullet), dejando la primera frase como intro.
  const prose = work.replace(/\s+/g, " ").trim();
  if (!prose) return sources || raw;
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
