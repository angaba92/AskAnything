/**
 * Genera una respuesta usando el backend MCP (`get_dy_knowledge`) reutilizando
 * las MISMAS plantillas de estilo del agente (detailed / bulleted / loopio /
 * simple). El servidor MCP respeta las instrucciones de formato, así que la
 * salida es coherente con el otro backend; además garantizamos las fuentes con
 * los datos estructurados que devuelve.
 */
import { getDyKnowledge, type McpSource } from "./mcpClient";
import {
  wrapForKnowledge,
  resolveMode,
  isTemplateEnabled,
  plainifyAnswer,
  enforceBullets,
} from "./promptTemplate";

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
  const wrapped =
    mode !== "simple" && isTemplateEnabled()
      ? wrapForKnowledge(question, mode)
      : question.trim();

  const res = await getDyKnowledge(preamble + wrapped);

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
