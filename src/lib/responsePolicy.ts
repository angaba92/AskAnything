/**
 * Política global para respuestas que se entregan directamente a clientes en
 * RFPs/RFIs. Mantener aquí las reglas editoriales evita que cada modo o proveedor
 * termine exponiendo el proceso interno de búsqueda de información.
 */
export const CLIENT_FACING_RFP_POLICY = `CLIENT-FACING RFP RULES (mandatory):
- Write the final answer as Mastercard Dynamic Yield speaking directly and professionally to a prospective customer.
- Return only the answer that can be pasted into an RFP/RFI. Never describe how the answer was researched or generated.
- Never mention searches, available sources, knowledge bases, internal or public documentation, inaccessible information, model limitations, missing access, or an inability to locate information.
- Never tell the customer to contact an account representative, Sales, Marketing, Legal, or another internal team.
- This is a bulk questionnaire: never ask a clarifying or follow-up question. Use the most commercially relevant interpretation and answer immediately. If several interpretations are plausible, lead with the most likely one and briefly cover the alternatives.
- Do not withhold the entire answer because exact confidential details are unavailable. Provide every supported, relevant point first, then use a short due-diligence statement only for the specific details that cannot be disclosed.
- Do not invent facts, commitments, certifications, awards, analyst positions, operational events, or contractual terms.
- Frame the client-facing answer positively around supported capabilities. Never open with "Partially.", "No.", or a limitation. Put uncertainty or missing evidence in the internal confidence-review signal, not in the opening.
- Never convert missing evidence into a negative factual claim such as "does not maintain", "has not received", "there are no", or "no material events". Lack of evidence is not evidence of absence.
- ALWAYS provide the best supported substantive answer available. Never replace the whole answer with a generic NDA, due-diligence, documentation-gap, or contact-us statement.
- If exact details are unavailable, answer positively at the strongest supported level and place the precise missing or uncertain details ONLY in the internal CONFIDENCE_REVIEW reason.
- Use an authoritative vendor voice ("Mastercard Dynamic Yield" or "we"), not an assistant/researcher voice ("I searched", "I found", "I could not find").
- Preserve the requested answer format, but these client-facing and factual-safety rules take priority.`;

const NON_CLIENT_FACING_PATTERNS: RegExp[] = [
  /\bbased on (?:my|the|our) (?:search|review|available (?:knowledge|information|sources?))/i,
  /\b(?:i|we) (?:was|were|am|are )?unable to (?:locate|find|identify|access)/i,
  /\b(?:i|we) (?:could not|couldn['’]t|cannot|can['’]t) (?:locate|find|identify|access)/i,
  /\b(?:my|our) (?:search|review) (?:of|through|did not|has not)/i,
  /\b(?:internal|available|underlying) knowledge (?:base|sources?)/i,
  /\bpublic documentation (?:does|do|did|is|was|has|appears)/i,
  /\bdocumentation (?:does|do) not (?:contain|include|cover|provide|address|detail|describe)/i,
  /\bnot (?:accessible|available) during (?:this|the) search/i,
  /\b(?:information|materials?) (?:was|were|is|are) not (?:found|located|available in the)/i,
  /\b(?:i|we) (?:recommend|suggest) contacting\b/i,
  /\bcontact (?:your|the|a) (?:Dynamic Yield )?(?:account representative|sales|marketing|legal|support) team\b/i,
  /\b(?:account representative|sales team|marketing department|legal team) directly\b/i,
  /\b(?:additional|further) clarification with (?:your|the) (?:Dynamic Yield )?(?:implementation|account|sales|product|support)?\s*team\b/i,
  /\b(?:may not|is not) be reflected in (?:the|my|our) (?:technical |product )?documentation\b/i,
  /\bi do not have (?:access|visibility|information)\b/i,
  /\bmy access to\b/i,
  /\bdoes not (?:maintain|have|provide) (?:documented|publicly available|disclosable)/i,
  /\bhas not (?:received|been (?:recognized|evaluated|named|included))/i,
  /\bthere (?:is|are) no (?:documented|publicly available|disclosable)/i,
  /\bno documented (?:information|evidence|recognition|evaluations?|events?)/i,
  /\bnot (?:publicly )?available for disclosure\b/i,
  /\bdoes not appear to (?:include|contain|provide|have)\b/i,
  /\bbased on (?:the )?(?:available|provided|reviewed)?\s*(?:documentation|materials?)\b/i,
  /\bbased on (?:the )?(?:knowledge )?sources? available\b/i,
  /\b(?:perfect|great)[.!]\s*(?:i|we) (?:now )?have\b/i,
  /\b(?:i|we) (?:now )?have (?:concrete|enough|the necessary) information\b/i,
  /\blet me (?:craft|prepare|write|formulate|summarize|provide)\b/i,
  /\b(?:here|below) (?:is|are) (?:the|an|our) (?:final |rfp[-\s]?ready )?(?:answer|response)\b/i,
  /\bsearch results? (?:do|does|did) not (?:provide|contain|include|show)\b/i,
  /\b(?:accessible|available) sources? (?:do|does|did) not\b/i,
  /\bnot (?:fully|comprehensively) documented in (?:the )?(?:accessible|available|public)\b/i,
  /\b(?:i|we) should provide what is confirmed\b/i,
  /\brfp[-\s]?critical question\b/i,
];

/** Detecta lenguaje sobre búsquedas/limitaciones internas no apto para clientes. */
export function hasNonClientFacingLanguage(text: string): boolean {
  return NON_CLIENT_FACING_PATTERNS.some((pattern) => pattern.test(text));
}

/** Fallback factual y client-facing cuando no hay soporte suficiente. */
export function clientFacingFallback(): string {
  return "Detailed information relevant to this requirement can be provided through the formal RFP due-diligence process and, where appropriate, under NDA.";
}

export const CONFIDENCE_REVIEW_INSTRUCTION = `BULK REVIEW SIGNAL (mandatory):
After the client-facing answer, add exactly one final line in this format:
CONFIDENCE_REVIEW: YES | <short reason>
or
CONFIDENCE_REVIEW: NO | Confident and sufficiently supported
Use YES only when there is a MATERIAL risk that the answer is wrong or unusable: you cannot provide a reliable substantive answer, the question has unresolved ambiguity that changes its meaning, a material claim is unsupported or conflicting, or essential customer-specific information is missing. Otherwise use NO.
Do NOT use YES merely because the question is broad, more detail could be added, formal validation would be beneficial, exact implementation details may vary, contractual terms require confirmation, or normal customer-specific configuration exists. This is a selective exception queue, not a general quality disclaimer. This line is internal metadata and will be removed before the answer is shown.`;

export interface ConfidenceReview {
  text: string;
  required: boolean;
  reason: string;
  found: boolean;
}

/** Extrae y elimina la marca interna de confianza devuelta por KA. */
export function extractConfidenceReview(text: string): ConfidenceReview {
  const marker =
    /^\s*(?:[•*-]\s*)?CONFIDENCE[\s_-]*REVIEW\s*:\s*(YES|NO)\s*(?:\||[-–—:])?\s*([^\n]*)\s*$/im;
  const match = (text ?? "").match(marker);
  if (!match) {
    return { text: (text ?? "").trim(), required: false, reason: "", found: false };
  }
  const required = match[1].toUpperCase() === "YES";
  return {
    text: (text ?? "").replace(marker, "").trim(),
    required,
    reason: required
      ? match[2].trim() || "The model requested manual verification."
      : "",
    found: true,
  };
}

const PROCESS_ONLY_LINE_PATTERNS: RegExp[] = [
  /^\s*(?:perfect|great|certainly|sure)[.!,:]/i,
  /^\s*(?:now\s+)?(?:i|we) (?:now )?have (?:sufficient|concrete|enough|the necessary) information\b/i,
  /^\s*(?:i|we) can provide (?:the )?(?:following )?(?:answer|response|information)\b/i,
  /\blet me (?:compose|craft|prepare|write|formulate|summarize|provide)\b/i,
  /^\s*(?:here|below) (?:is|are) (?:the|an|our) (?:final |rfp[-\s]?ready )?(?:answer|response)\b/i,
  /^\s*based on\b.*\b(?:i|we) can (?:now )?(?:provide|compose|craft|prepare|write|formulate|summarize)\b/i,
  /^\s*based on\b.*\b(?:search results?|accessible sources?|rfp[-\s]?critical|i should)\b/i,
  /^\s*based on (?:the )?(?:available|provided|reviewed)?\s*(?:documentation|information|sources?|materials?)[,:]?\s*(?:(?:i|we) can provide|here|below|the following)\b/i,
];

const CLARIFICATION_PATTERNS: RegExp[] = [
  /\b(?:i|we) need to clarify (?:your|the) question\b/i,
  /\b(?:could|can|would) you clarify\b/i,
  /\bbefore (?:i|we) (?:search|answer|proceed)\b/i,
  /\bwhen you (?:ask|say|refer to|mention)\b[\s\S]{0,180}\bare you referring to\b/i,
  /\bare you referring to\s*:?\s*(?:\d+[.)]|[-*•])/i,
  /\bthis will help (?:me|us) (?:point you|provide|identify|answer)\b/i,
  /\bplease (?:clarify|specify|confirm) (?:which|whether|what)\b/i,
  /\bno actual question (?:was|has been|is) (?:provided|included|asked)\b/i,
  /\bplease provide (?:the|a) specific (?:rfp |rfi )?(?:question|prompt)\b/i,
  /\bwhat is the (?:specific )?question\??/i,
  /\b(?:i am|i['’]m|we are|we['’]re) ready to help\b/i,
];

/** Identifica respuestas que devuelven preguntas al usuario, inválidas en bulk. */
export function isClarificationRequest(text: string): boolean {
  return CLARIFICATION_PATTERNS.some((pattern) => pattern.test(text));
}

/** Garantiza que Loopio empiece con una respuesta directa, no con un título/lista. */
export function lacksDirectAnswerOpening(text: string): boolean {
  const firstLine = (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine || /^[•*-]\s+/.test(firstLine)) return true;

  const words = firstLine.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  const looksLikeHeading =
    words.length > 0 &&
    words.length <= 5 &&
    !/[.!?]/.test(firstLine) &&
    words.every(
      (word) => /^[A-Z][a-z]/.test(word) || /^[A-Z]{2,}$/.test(word),
    );
  return looksLikeHeading;
}

/**
 * Elimina preámbulos de razonamiento que algunos modelos imprimen antes de una
 * respuesta válida. No reescribe el contenido sustantivo: solo descarta líneas
 * claramente procesales y separadores Markdown.
 */
export function stripNonClientFacingPreamble(text: string): string {
  let lines = (text ?? "").split(/\r?\n/);

  // KA a veces imprime primero su razonamiento, inserta `---` y luego repite una
  // respuesta final válida. Si el bloque anterior al primer separador contiene
  // lenguaje interno, lo descartamos completo y conservamos la respuesta final.
  const separatorIndex = lines.findIndex((line) =>
    /^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line)
  );
  if (separatorIndex >= 0) {
    const prefix = lines.slice(0, separatorIndex).join("\n");
    if (
      hasNonClientFacingLanguage(prefix) ||
      PROCESS_ONLY_LINE_PATTERNS.some((pattern) => pattern.test(prefix))
    ) {
      lines = lines.slice(separatorIndex + 1);
    }

  }

  const cleaned = lines
    .map((line) => {
      const trimmed = line.trim();
      if (/^(?:-{3,}|_{3,}|\*{3,})$/.test(trimmed)) return null;

      // Si el modelo usa "Based on the available documentation," como mero
      // prefijo de una frase sustantiva, conservamos la afirmación posterior.
      const withoutSourcePreamble = line.replace(
        /^\s*based on (?:the )?(?:available|provided|reviewed)?\s*(?:documentation|information|sources?|materials?)[,;:]\s*/i,
        ""
      );
      if (
        PROCESS_ONLY_LINE_PATTERNS.some(
          (pattern) => pattern.test(line) || pattern.test(withoutSourcePreamble)
        )
      ) {
        return null;
      }
      return withoutSourcePreamble;
    })
    .filter((line): line is string => line !== null);

  return cleaned.join("\n").replace(/^\s+|\s+$/g, "").replace(/\n{3,}/g, "\n\n");
}

/**
 * Elimina bloques completos sobre búsquedas, acceso, documentación o peticiones
 * de aclaración, preservando cualquier párrafo/viñeta sustantivo de la respuesta.
 */
export function stripNonClientFacingPassages(text: string): string {
  const withoutPreamble = stripNonClientFacingPreamble(text);
  const blocks = withoutPreamble.split(/\n{2,}/);
  const kept = blocks.filter(
    (block) =>
      !hasNonClientFacingLanguage(block) &&
      !isClarificationRequest(block) &&
      !/^\s*(?:recommendation|sources?)\s*:/i.test(block),
  );
  return kept.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

export interface SeparatedReviewLimitations {
  answer: string;
  limitations: string[];
}

const REVIEW_ONLY_LIMITATION =
  /\b(?:is|are|was|were)?\s*not\s+(?:documented|described|disclosed|published|available|confirmed|verified|substantiated|supported|covered)\b|\bdoes not (?:document|describe|detail|disclose|publish|confirm|verify|substantiate|support|cover)\b|\brequires? (?:manual )?(?:review|validation|confirmation|clarification)\b|\b(?:additional|further) clarification\b|\b(?:formal )?(?:due[-\s]?diligence|nda)\b|\b(?:available|published) (?:product |public )?documentation\b/i;

/**
 * Separa limitaciones internas que el modelo haya dejado dentro de una respuesta.
 * Conserva el contenido positivo anterior a "However/That said", pero mueve el
 * resto a Needs Review.
 */
export function separateReviewLimitations(
  text: string,
): SeparatedReviewLimitations {
  const limitations: string[] = [];
  const answerBlocks: string[] = [];

  for (const rawBlock of (text ?? "").split(/\n{2,}/)) {
    let block = rawBlock.trim();
    if (!block) continue;

    const transition = block.search(
      /\b(?:However|Nevertheless|That said|While these capabilities are supported),?\s/i,
    );
    if (transition > 0) {
      const tail = block.slice(transition).trim();
      if (REVIEW_ONLY_LIMITATION.test(tail)) {
        limitations.push(tail);
        block = block.slice(0, transition).trim();
      }
    }

    if (!block) continue;
    if (REVIEW_ONLY_LIMITATION.test(block)) {
      limitations.push(block);
      continue;
    }
    answerBlocks.push(block);
  }

  return {
    answer: answerBlocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim(),
    limitations,
  };
}
