/**
 * Genera una respuesta usando el backend MCP (`get_dy_knowledge`) reutilizando
 * las MISMAS plantillas de estilo del agente (detailed / bulleted / loopio /
 * simple). El servidor MCP respeta las instrucciones de formato, así que la
 * salida es coherente con el otro backend; además garantizamos las fuentes con
 * los datos estructurados que devuelve.
 */
import { getDyKnowledge, type McpSource } from "./mcpClient";
import { resolveMode, plainifyAnswer, enforceBullets } from "./promptTemplate";

/**
 * Instrucciones de formato CONCISAS para el backend MCP. El servidor MCP se
 * atraganta con las plantillas largas del agente (devuelve "Failed to execute
 * tool"), así que aquí usamos versiones breves y equivalentes, verificadas
 * contra el endpoint real.
 */
const MCP_INSTRUCTIONS: Record<string, string> = {
  detailed:
    'Answer in plain text, no markdown, no headings. Start with one paragraph that answers directly, then 3-4 paragraphs of depth, then one paragraph with a concrete real-world example. End with a line "Sources: " listing the full URL(s), separated by "; ". Omit that line if you have no sources.',
  bulleted:
    'Answer in plain text, no markdown. Start with 1-2 sentences answering directly. Then 4-7 bullets, each on its own line starting with "• " and self-contained (a couple of sentences is fine). Then a short paragraph starting "As an example, ". End with a line "Sources: " listing the full URL(s), separated by "; ". Omit that line if you have no sources.',
  loopio:
    'Answer in plain text, RFP style, using "• " for bullets. 1) One-sentence verdict starting "Yes." or "No." or "Partially." then "Mastercard Dynamic Yield " and the essence. 2) One or more short themed sections: each a 2-4 word Title Case heading on its own line, followed by "• " bullets. 3) A paragraph starting "For example, ". 4) A closing line starting "For more information, please refer to our " with the resource name and its full URL in parentheses. Omit that line if you have no source.',
};

export interface KnowledgeAnswer {
  answer: string;
  /** URLs de las fuentes citadas (para la columna "sources" del batch). */
  sourcesText: string;
  sources: McpSource[];
}

/** Responde una pregunta puntual vía MCP, con el estilo elegido. */
export async function answerViaMcp(
  question: string,
  opts: { mode?: string; structured?: boolean; context?: string } = {}
): Promise<KnowledgeAnswer> {
  const mode = resolveMode(opts);
  const preamble = opts.context?.trim() ? `${opts.context.trim()}\n\n` : "";
  const instructions = MCP_INSTRUCTIONS[mode];
  const query = instructions
    ? `${preamble}${question.trim()}\n\n${instructions}`
    : `${preamble}${question.trim()}`;

  const res = await getDyKnowledge(query);

  let answer = plainifyAnswer(res.text);
  if (mode === "bulleted") answer = enforceBullets(answer);

  const urls = res.sources
    .map((s) => s.uri)
    .filter((u): u is string => Boolean(u));
  const sourcesText = urls.join("; ");

  // Si el modelo no incluyó ninguna URL en el texto pero tenemos fuentes
  // estructuradas, las añadimos al final (misma convención que las plantillas).
  if (urls.length && !/https?:\/\//.test(answer)) {
    answer = answer
      ? `${answer}\n\nSources: ${sourcesText}`
      : `Sources: ${sourcesText}`;
  }

  return { answer, sourcesText, sources: res.sources };
}
