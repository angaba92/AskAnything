/**
 * Proveedor "ka" — DY Knowledge Assistant (nueva plataforma por defecto).
 *
 * Es stateless: cada pregunta se envía como una conversación nueva de un solo
 * turno a {KA_URL}/api/chat. Reutiliza la capa de mapeo de prompts para el
 * estilo y la normalización existente (plainifyAnswer / enforceBullets) para que
 * la salida sea coherente con el resto de la aplicación.
 */

import { kaChat, parseKaSources } from "../kaClient";
import { findCuratedRfpHint } from "../curatedRfpKnowledge";
import {
  buildKaUserContent,
  extractConfidenceNote,
  extractConfidenceReview,
  extractSourceUrls,
  hasNonClientFacingLanguage,
  isClarificationRequest,
  isInternalSourceUrl,
  separateReviewLimitations,
  stripInternalSourceLinks,
  stripNonClientFacingPreamble,
  stripNonClientFacingPassages,
  stripNonClientFacingSentences,
} from "../promptMapping";
import { resolveMode, plainifyAnswer, enforceBullets, formatLoopioSections } from "../promptTemplate";
import { extractClientAnswer, hasSubstantiveAnswer, loopioFormatIssues, separateClientFacingResponse } from "../responsePolicy";
import type { GenerateOpts, ProviderAnswer } from "./types";

export function normalizeBridgedKaResponse(
  rawText: string,
  opts: GenerateOpts,
): ProviderAnswer {
  const mode = resolveMode(opts);
  const isCustomMode = mode === "custom";
  const sources = parseKaSources(rawText).filter(
    (source) => !isInternalSourceUrl(source.uri ?? ""),
  );
  const confidence = extractConfidenceReview(rawText);
  const frame = mode === "loopio" ? extractClientAnswer(confidence.text) : { text: confidence.text, incomplete: false };
  const note = extractConfidenceNote(frame.text);
  const sourceHeading = note.text.search(/^\s*(?:#{1,6}\s*|\*\*)?(?:sources?|references?)\s*(?:\*\*)?\s*:?\s*$/im);
  const body = !isCustomMode && sourceHeading >= 0
    ? note.text.slice(0, sourceHeading)
    : note.text;
  const separated = separateClientFacingResponse(isCustomMode ? body : plainifyAnswer(body));
  let answer = stripInternalSourceLinks(separated.answer);
  const normalizedConfidence =
    opts.confidenceReview
      ? extractConfidenceReview(answer)
      : { text: answer, required: false, reason: "", found: false };
  answer = normalizedConfidence.text;

  if (mode === "bulleted") answer = enforceBullets(answer);
  if (mode === "loopio") {
    answer = answer.replace(/^\s*(?:Partially|No)\.\s*/i, "");
    answer = formatLoopioSections(answer);
  }

  const urls = Array.from(
    new Set([
      ...sources
        .map((source) => source.uri)
        .filter((url): url is string => Boolean(url)),
      ...extractSourceUrls(rawText),
    ]),
  ).filter((url) => !isInternalSourceUrl(url));
  const sourcesText = urls.join("; ");
  if (urls.length > 0 && hasSubstantiveAnswer(answer) && !/https?:\/\//.test(answer)) {
    answer = `${answer}\n\nSources: ${sourcesText}`;
  }
  const noteNeedsReview = Boolean(note.note) && !/^(?:high|confident|full)(?:\b|$)/i.test(note.note);
  const formatIssues = mode === "loopio" ? loopioFormatIssues(answer) : [];
  const reviewReasons = [...new Set([
    confidence.reason,
    normalizedConfidence.reason,
    noteNeedsReview ? note.note : "",
    ...separated.limitations,
    ...separateReviewLimitations(separated.answer).limitations,
    isClarificationRequest(body) ? "The response asks for clarification; review the interpretation." : "",
    formatIssues.length ? `Incomplete Loopio format: missing ${formatIssues.join("; ")}. The available answer is preserved, not padded with invented content.` : "",
    frame.incomplete ? "The client-answer boundary was incomplete; review for a truncated response." : "",
  ].filter(Boolean))];

  return {
    answer,
    sources,
    sourcesText,
    expert: "knowledge_assistant",
    threadId: "",
    reviewRequired: reviewReasons.length > 0,
    reviewReason: reviewReasons.join("\n\n"),
  };
}

export async function kaGenerate(opts: GenerateOpts): Promise<ProviderAnswer> {
  const mode = resolveMode(opts);
  const isCustomMode = mode === "custom";
  // Batch and Redo use exactly the same prompt and normalization as the bridge.
  // No curated override may discard owner-provided guidance, and no rewrite is
  // generated behind the batch scheduler's back.
  if (opts.confidenceReview || mode === "loopio") {
    const content = buildKaUserContent(opts.question, { ...opts, mode });
    const result = await kaChat([{ role: "user", content }], {
      retries: 0,
      timeoutMs: 180000,
      signal: opts.signal,
    });
    return normalizeBridgedKaResponse(result.text, opts);
  }
  const curated = isCustomMode ? null : findCuratedRfpHint(opts.question);
  const curatedForMode = curated;
  const enrichedContext = [opts.context?.trim(), curatedForMode?.promptContext]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
  const content = buildKaUserContent(opts.question, {
    mode,
    context: enrichedContext || undefined,
    confidenceReview: opts.confidenceReview,
    customPrompt: opts.customPrompt,
  });

  // Gaps conocidos y ya verificados: devolvemos la respuesta curada directamente.
  // No la pasamos por el LLM, porque podría ignorar la pregunta o añadir prácticas
  // organizativas no presentes en el contexto (headcounts, runbooks, frameworks).
  let res = curatedForMode
    ? { text: curatedForMode.safeAnswer, sources: curatedForMode.sources }
    : await kaChat([{ role: "user", content }]);
  let reviewRequired = false;
  let reviewReason = "";
  let clarificationSeen = false;

  // En bulk no hay interacción posterior. Si KA devuelve una pregunta de
  // aclaración, reintentamos una sola vez obligándole a escoger la interpretación
  // comercial más relevante y a cubrir brevemente alternativas plausibles.
  if (!curatedForMode && !isCustomMode && isClarificationRequest(res.text)) {
    clarificationSeen = true;
    console.warn("[ka] clarification request detected; retrying with best-interpretation instruction");
    const retryQuestion = `${opts.question.trim()}

IMPORTANT FOR THIS BULK RFP ITEM: Do not ask any clarifying or follow-up questions. Select the most commercially relevant Dynamic Yield capability implied by the wording and answer immediately with the best supported information. If multiple interpretations are plausible, lead with the most likely one and briefly cover the alternatives.`;
    const retryContent = buildKaUserContent(retryQuestion, {
      mode,
      context: enrichedContext || undefined,
      confidenceReview: opts.confidenceReview,
      customPrompt: opts.customPrompt,
    });
    res = await kaChat([{ role: "user", content: retryContent }]);
  }

  if (opts.confidenceReview && !curatedForMode) {
    const confidence = extractConfidenceReview(res.text);
    res = { ...res, text: confidence.text };
    // Missing metadata must not mark every row: KA occasionally omits the marker.
    // We only flag an explicit YES or a real clarification/fallback condition.
    reviewRequired = confidence.required || clarificationSeen;
    reviewReason = confidence.required
      ? confidence.reason
      : clarificationSeen
        ? "The initial answer required clarification; verify the interpretation."
        : "";
  }

  // Primero eliminamos preámbulos procesales ("Perfect. Let me craft...",
  // "Based on the available documentation, here is...") conservando la respuesta
  // sustantiva que aparece después.
  const cleanedDraft = isCustomMode
    ? res.text
    : stripNonClientFacingPreamble(res.text);

  const needsRecovery =
    !cleanedDraft ||
    (!isCustomMode && isClarificationRequest(cleanedDraft)) ||
    (!isCustomMode && hasNonClientFacingLanguage(cleanedDraft));

  if (needsRecovery && !isCustomMode && !curatedForMode) {
    // Nunca sustituimos por un fallback NDA. Pedimos una redacción de rescate que
    // conserve todos los hechos útiles y mueva las limitaciones SOLO a review.
    console.warn("[ka] recovering best substantive answer from an internal/gap draft");
    reviewRequired = true;
    const originalDraft = res.text;
    const recoveryQuestion = `${opts.question.trim()}

The previous draft contained internal research commentary, a refusal, a clarification request, or documentation-gap language. Produce the BEST POSSIBLE substantive client-facing answer now.

Mandatory recovery rules:
- Preserve every supported, useful capability or fact from the draft.
- Answer positively at the strongest supported level.
- Never replace the answer with a generic NDA/due-diligence statement.
- Never mention searches, sources being unavailable, documentation gaps, internal teams, or what you cannot access.
- Put the exact unsupported, uncertain, confidential, or customer-specific details only in CONFIDENCE_REVIEW: YES | <specific limitations>.

Previous draft:
${originalDraft}`;
    const recoveryContent = buildKaUserContent(recoveryQuestion, {
      mode,
      context: enrichedContext || undefined,
      confidenceReview: opts.confidenceReview,
    });
    const recovered = await kaChat([{ role: "user", content: recoveryContent }]);
    const recoveredConfidence = opts.confidenceReview
      ? extractConfidenceReview(recovered.text)
      : {
          text: recovered.text,
          required: false,
          reason: "",
          found: false,
        };
    const recoveredText = stripNonClientFacingPassages(
      recoveredConfidence.text,
    );
    const salvagedOriginal = stripNonClientFacingPassages(originalDraft);
    res = {
      text: recoveredText || salvagedOriginal || cleanedDraft,
      sources:
        recovered.sources.length > 0 ? recovered.sources : res.sources,
    };
    if (recoveredConfidence.required && recoveredConfidence.reason) {
      reviewReason = recoveredConfidence.reason;
    } else if (!reviewReason) {
      reviewReason =
        "Verify the specific product, implementation, or commitment details that were not fully supported in the source response.";
    }
  } else {
    res = { ...res, text: cleanedDraft };
  }

  // Si KA usó el contexto curado pero omitió sus fuentes, las conservamos para
  // que el batch pueda completar tanto la respuesta como la columna de fuentes.
  if (curatedForMode?.sources.length && res.sources.length === 0) {
    res = { ...res, sources: curatedForMode.sources };
  }

  // Normalizamos igual que el resto de backends: markdown → texto plano y, en
  // modo viñetas, garantizamos el formato aunque el modelo devuelva prosa.
  let answer = isCustomMode ? res.text.trim() : plainifyAnswer(res.text);
  if (!isCustomMode) {
    answer = stripInternalSourceLinks(answer);
    const note = extractConfidenceNote(answer);
    answer = note.text;
    if (note.note) {
      reviewRequired = true;
      if (!reviewReason) reviewReason = note.note;
    }
  }
  if (mode === "bulleted") answer = enforceBullets(answer);
  if (!isCustomMode && hasNonClientFacingLanguage(answer)) {
    // Misma limpieza que el camino puenteado: quitamos solo los bloques internos
    // (nunca la respuesta entera) y marcamos la revisión.
    const salvaged = plainifyAnswer(stripNonClientFacingSentences(answer));
    if (salvaged) answer = salvaged;
    reviewRequired = true;
    if (!reviewReason) {
      reviewReason =
        "Verify the claims that rely on internal or insufficiently supported reasoning.";
    }
  }
  if (!isCustomMode) {
    const separated = separateReviewLimitations(answer);
    if (separated.limitations.length > 0) {
      answer = separated.answer;
      reviewRequired = true;
      if (!reviewReason) {
        reviewReason = separated.limitations.join(" ");
      }
    }
  }

  const urls = Array.from(
    new Set([
      ...res.sources.map((s) => s.uri).filter((u): u is string => Boolean(u)),
      ...extractSourceUrls(res.text),
    ]),
  ).filter((u) => !isInternalSourceUrl(u));
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
    reviewRequired,
    reviewReason,
  };
}
