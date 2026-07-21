/**
 * Proveedor "ka" — DY Knowledge Assistant (nueva plataforma por defecto).
 *
 * Es stateless: cada pregunta se envía como una conversación nueva de un solo
 * turno a {KA_URL}/api/chat. Reutiliza la capa de mapeo de prompts para el
 * estilo y la normalización existente (plainifyAnswer / enforceBullets) para que
 * la salida sea coherente con el resto de la aplicación.
 */

import { kaChat } from "../kaClient";
import { buildKaUserContent } from "../promptMapping";
import { resolveMode, plainifyAnswer, enforceBullets } from "../promptTemplate";
import type { GenerateOpts, ProviderAnswer } from "./types";

export async function kaGenerate(opts: GenerateOpts): Promise<ProviderAnswer> {
  const mode = resolveMode(opts);
  const content = buildKaUserContent(opts.question, { mode, context: opts.context });

  const res = await kaChat([{ role: "user", content }]);

  // Normalizamos igual que el resto de backends: markdown → texto plano y, en
  // modo viñetas, garantizamos el formato aunque el modelo devuelva prosa.
  let answer = plainifyAnswer(res.text);
  if (mode === "bulleted") answer = enforceBullets(answer);

  const urls = res.sources
    .map((s) => s.uri)
    .filter((u): u is string => Boolean(u));
  const sourcesText = urls.join("; ");

  // Si el modelo citó fuentes en el bloque "## Sources" pero no dejó ninguna URL
  // en el cuerpo, las añadimos al final (misma convención que los otros modos).
  if (urls.length && !/https?:\/\//.test(answer)) {
    answer = answer ? `${answer}\n\nSources: ${sourcesText}` : `Sources: ${sourcesText}`;
  }

  return {
    answer,
    sourcesText,
    sources: res.sources,
    expert: "knowledge_assistant",
    threadId: "",
  };
}
