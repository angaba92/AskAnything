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
- Answer regional and jurisdictional questions with what IS supported. If the exact country asked about has no local facility or endpoint but the region is served from another supported location (for example, UK traffic served from the EU data centre in Germany), state the supported arrangement and how it serves that market. Never answer "no" or "not available" when a supported regional option exists.
- ALWAYS provide the best supported substantive answer available. Never replace the whole answer with a generic NDA, due-diligence, documentation-gap, or contact-us statement.
- If exact details are unavailable, answer positively at the strongest supported level and place the precise missing or uncertain details ONLY in the internal CONFIDENCE_REVIEW reason.
- Use an authoritative vendor voice ("Mastercard Dynamic Yield" or "we"), not an assistant/researcher voice ("I searched", "I found", "I could not find").
- You may fully use the knowledge found in internal sources (Guru, Confluence, internal wikis) to build the answer, but NEVER cite, name, or link them. Only cite customer-facing resources: the Dynamic Yield Knowledge Base (support.dynamicyield.com) and the developer documentation. If the only supporting material is internal, still give the full substantive answer and simply omit the source line.
- Preserve the requested answer format, but these client-facing and factual-safety rules take priority.`;

const NON_CLIENT_FACING_PATTERNS: RegExp[] = [
  /\bbased on (?:my|the|our) (?:search|review|available (?:knowledge|information|sources?))/i,
  /\b(?:i|we) (?:(?:was|were|am|are)\s+)?unable to (?:locate|find|identify|access)/i,
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
  /\b(?:reference|information|result)s?\s+(?:that\s+)?(?:i|we)\s+found\b/i,
  /\binternal (?:troubleshooting|guidance|sources?|references?)\b/i,
  /^\s*(?:i|we) found (?:information|references?|documentation|evidence)\b/i,
  /^\s*(?:the )?documentation (?:references|describes|mentions)\b/i,
];

// Recognize a research-status statement by its subject/action/object, not by
// enumerating adjectives such as "comprehensive", "concrete" or "limited".
const RESEARCH_STATUS =
  /^(?:(?:now|first|next|finally)[,:]?\s+)?i(?:['’]ve)?\s+(?:now\s+)?(?:have|had|found|gathered|collected|located|identified|reviewed|obtained)\b[^.!?\n]*\b(?:information|documentation|sources?|resources?|materials?|evidence|details|context|understanding)\b/i;
const RESEARCH_UNCERTAINTY =
  /\b(?:limited|little|insufficient|missing|incomplete|unavailable|unable|cannot|could not|not|no|only)\b/i;

/** Detecta lenguaje sobre búsquedas/limitaciones internas no apto para clientes. */
export function hasNonClientFacingLanguage(text: string): boolean {
  return RESEARCH_STATUS.test(text.trim()) ||
    NON_CLIENT_FACING_PATTERNS.some((pattern) => pattern.test(text));
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
    /^[ \t]*(?:[•*-][ \t]+)?[*_`]*CONFIDENCE[\s_-]*REVIEW[*_`]*\s*:[*_`]*\s*(YES|NO)[*_`]*\s*(?:\||[-–—:])?\s*([^\n]*)$/gim;
  const reasons: string[] = [];
  let found = false;
  const cleaned = (text ?? "").replace(marker, (_match, flag: string, reason: string) => {
    found = true;
    if (flag.toUpperCase() === "YES") {
      reasons.push(reason.replace(/[*_`]+\s*$/, "").trim() || "The model requested manual verification.");
    }
    return "";
  });
  return {
    text: cleaned.trim(),
    required: reasons.length > 0,
    reason: [...new Set(reasons)].join(" "),
    found,
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
  const cleaned = (text ?? "").split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (/^(?:-{3,}|_{3,}|\*{3,})$/.test(trimmed)) return null;
      // Split at boundaries, not by matching sentence contents: decimals and
      // URLs must remain byte-for-byte intact.
      return line.split(/(?<=[.!?])\s+(?=[A-Z])/).map((part) => {
        const value = part
          .replace(/^\s*(?:perfect|great|certainly|sure)[.!,:]\s*/i, "")
          .replace(/^\s*(?:based on|according to)\b[^,;:\n]*\b(?:documentation|information|sources?|materials?|search|research|knowledge|guru)\b[^,;:\n]*[,;:]\s*/i, "")
          .replace(/^\s*(?:here|below) (?:is|are) (?:the|an|our) (?:final |rfp[-\s]?ready )?(?:answer|response)\s*:\s*/i, "");
        const statusOnly = RESEARCH_STATUS.test(value.trim()) && !RESEARCH_UNCERTAINTY.test(value);
        return statusOnly || PROCESS_ONLY_LINE_PATTERNS.some((pattern) => pattern.test(value)) ? "" : value;
      }).filter(Boolean).join(" ");
    })
    .filter((line): line is string => line !== null);

  return cleaned.join("\n").replace(/^\s+|\s+$/g, "").replace(/\n{3,}/g, "\n\n");
}

/**
 * Elimina SOLO las frases internas (búsquedas, refusals, huecos de documentación)
 * conservando el resto del párrafo. Es menos destructivo que filtrar bloques
 * enteros, que borraba respuestas válidas por una sola frase.
 */
export function stripNonClientFacingSentences(text: string): string {
  return separateClientFacingResponse(text).answer;
}

const DOCUMENTATION_GAP =
  /\bnot\s+(?:(?:publicly|explicitly|fully|comprehensively|currently)\s+)?(?:documented|described|disclosed|published|detailed|quantified|specified|verified|confirmed|substantiated)\b|\b(?:documentation|sources?|information)\b[^.!?\n]*\b(?:does not|do not|cannot|can't|lack|lacks|missing|unavailable)\b|\b(?:metrics?|figures?|benchmarks?|specifications?)\b[^.!?\n]*\bnot available\b/i;
const SOURCE_COMMENTARY =
  /^(?:however[, ]+)?(?:the\s+)?(?:(?:available|public|published|accessible|provided|developer|technical|internal|product)\s+)*(documentation|sources?|resources?|materials?|references?|evidence|search results?|knowledge base)\s+(covers?|describes?|mentions?|references?|includes?|contains?|provides?|details?|does|do|is|are|lacks?)\b/i;
const INTERNAL_REFERRAL =
  /\b(?:contact|consult|reach out to|work(?:ing)? with|speak (?:to|with))\b[^.!?\n]*\b(?:account (?:representative|team|manager)|technical (?:support|consultation)|(?:sales|support|legal|implementation|product) team)\b|\b(?:account representative|sales team|support team|technical consultation)\b[^.!?\n]*\b(?:provide|available|confirm|details|specifications)\b/i;

function editorialSentence(text: string): boolean {
  const value = text.replace(/^[\s•*#_`+-]+/, "").trim();
  const source = SOURCE_COMMENTARY.exec(value);
  const sourceCommentary = source !== null &&
    !(/^(?:resources?|materials?)$/i.test(source[1]) && /^(?:is|are)$/i.test(source[2]));
  return RESEARCH_STATUS.test(value) ||
    DOCUMENTATION_GAP.test(value) || sourceCommentary ||
    INTERNAL_REFERRAL.test(value) || isClarificationRequest(value) ||
    (/^(?:i|we|based on|the only)\b/i.test(value) && hasNonClientFacingLanguage(value));
}

/**
 * Separate internal research from client copy. A research-led list belongs to
 * its introduction; a caveat elsewhere must not consume the adjacent facts.
 */
export function separateClientFacingResponse(text: string): SeparatedReviewLimitations {
  const limitations: string[] = [];
  const kept: string[] = [];
  let researchList = false;
  const bullet = /^\s*(?:[•*+-]|\d+[.)])\s+/;
  for (const raw of (text ?? "").split(/\r?\n/)) {
    if (!raw.trim()) {
      kept.push("");
      continue;
    }
    if (researchList && bullet.test(raw)) {
      limitations.push(raw.trim());
      continue;
    }
    researchList = false;
    const parts = raw.split(/(?<=[.!?])\s+(?=[A-Z*_])/);
    const answerParts: string[] = [];
    for (const part of parts) {
      const value = stripNonClientFacingPreamble(part).replace(
        /^(\s*(?:[•*+-]\s+)?)(?:the\s+)?(?:(?:available|public|published|developer|technical|product)\s+)*documentation (?:states|confirms|notes|indicates|explains) that\s+/i,
        "$1",
      );
      if (!value.trim() || /^[\s•*#_`+-]+$/.test(value)) continue;
      const transition = value.search(/[,;]\s*(?:however|but|while|although|yet|nevertheless|with)\b/i);
      if (transition > 0 && editorialSentence(value.slice(transition + 1))) {
        const fact = value.slice(0, transition).trim();
        if (!editorialSentence(fact)) {
          answerParts.push(/[.!?]$/.test(fact) ? fact : `${fact}.`);
          limitations.push(value.slice(transition + 1).trim());
          continue;
        }
      }
      if (editorialSentence(value)) {
        limitations.push(part.trim());
        if (/:["*_`\s]*$/.test(value)) researchList = true;
      } else {
        answerParts.push(value);
      }
    }
    if (answerParts.length) kept.push(answerParts.join(" "));
  }
  return {
    answer: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    limitations: [...new Set(limitations)],
  };
}

/**
 * Elimina bloques completos sobre búsquedas, acceso, documentación o peticiones
 * de aclaración, preservando cualquier párrafo/viñeta sustantivo de la respuesta.
 * Nunca devuelve vacío: si el filtro se llevaría todo, conserva el texto sin
 * preámbulo para que la fila siempre tenga la mejor respuesta disponible.
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
  const filtered = kept.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return filtered || withoutPreamble.trim();
}

/**
 * Extrae la nota de confianza en cursiva que KA añade al final
 * ("_Confidence: partial — ..._"). Es metadato interno: sale de la respuesta y
 * se ofrece como motivo de revisión.
 */
export function extractConfidenceNote(text: string): {
  text: string;
  note: string;
} {
  const pattern =
    /^\s*[_*]{0,2}\s*Confidence\s*:\s*([^\n]*?)\s*[_*]{0,2}\s*$/gim;
  const notes: string[] = [];
  const stripped = (text ?? "").replace(pattern, (_match, reason: string) => {
    const clean = reason.replace(/[_*]+\s*$/, "").trim();
    if (clean) notes.push(clean);
    return "";
  });
  return {
    text: stripped.replace(/\n{3,}/g, "\n\n").trim(),
    note: notes.join(" "),
  };
}

/** Dominios internos que nunca deben aparecer en una respuesta de cliente. */
const INTERNAL_SOURCE_HOSTS =
  /(?:app\.)?getguru\.com|atlassian\.net|confluence\b|jira\b|slack\.com|sharepoint\.com/i;

/** True si una URL apunta a una herramienta interna (Guru, Confluence, etc.). */
export function isInternalSourceUrl(url: string): boolean {
  return INTERNAL_SOURCE_HOSTS.test(url ?? "");
}

/**
 * Elimina enlaces a herramientas internas del texto entregado al cliente.
 * Solo se permiten la Knowledge Base y la documentación de desarrollo.
 */
export function stripInternalSourceLinks(text: string): string {
  const lines = (text ?? "").split(/\r?\n/).flatMap((line) => {
    const urls = line.match(/https?:\/\/[^\s)\]]+/g) ?? [];
    if (urls.length === 0) return [line];
    const internal = urls.filter((url) => isInternalSourceUrl(url));
    if (internal.length === 0) return [line];

    // Si la línea existe solo para citar la fuente interna, se descarta entera.
    if (internal.length === urls.length && /^\s*(?:[•*-]\s*)?(?:sources?|for more information)\b/i.test(line)) {
      return [];
    }
    let cleaned = line;
    for (const url of internal) {
      cleaned = cleaned
        .replace(new RegExp(`\\s*\\(${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`, "g"), "")
        .split(url)
        .join("");
    }
    cleaned = cleaned.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
    return cleaned && !/^[•*\-–—:;,.\s]*$/.test(cleaned) ? [cleaned] : [];
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** URLs citadas en líneas de fuentes ("Sources: …", "For more information…"). */
export function extractSourceUrls(text: string): string[] {
  const urls: string[] = [];
  for (const line of (text ?? "").split(/\r?\n/)) {
    if (!/^\s*(?:[•*-]\s*)?(?:sources?|references?|for more information)\b/i.test(line)) {
      continue;
    }
    for (const url of line.match(/https?:\/\/[^\s)\];,]+/g) ?? []) {
      if (!isInternalSourceUrl(url) && !urls.includes(url)) urls.push(url);
    }
  }
  return urls;
}

export interface SeparatedReviewLimitations {
  answer: string;
  limitations: string[];
}

const REVIEW_ONLY_LIMITATION =
  /\b(?:is|are|was|were)?\s*not\s+(?:documented|described|disclosed|published|available|confirmed|verified|substantiated|supported|covered)\b|\bdoes not (?:document|describe|detail|disclose|publish|confirm|verify|substantiate|support|cover)\b|\brequires? (?:manual )?(?:review|validation|confirmation|clarification)\b|\b(?:additional|further) clarification\b|\b(?:formal )?(?:due[-\s]?diligence|nda)\b|\b(?:available|published) (?:product |public )?documentation\b/i;

/**
 * Detecta limitaciones internas para señalarlas en Needs Review SIN recortar la
 * respuesta: el contenido de KA se respeta íntegro y la fila siempre conserva la
 * mejor respuesta disponible.
 */
export function separateReviewLimitations(
  text: string,
): SeparatedReviewLimitations {
  const limitations: string[] = [];
  for (const rawBlock of (text ?? "").split(/\n{2,}/)) {
    const block = rawBlock.trim();
    if (!block) continue;
    if (REVIEW_ONLY_LIMITATION.test(block)) limitations.push(block);
  }
  return { answer: (text ?? "").trim(), limitations };
}

/** Reject formatting/citations alone, without judging the factual answer. */
export function hasSubstantiveAnswer(text: string): boolean {
  return (text ?? "").split(/\r?\n/).some((line) => {
    if (/^\s*(?:#{1,6}\s|(?:sources?|references?|confidence[\s_-]*review|confidence)\s*:)/i.test(line)) return false;
    const body = line
      .replace(/\[[^\]]*\]\(https?:\/\/[^)\s]+\)/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/^[\s•*#_+-]+/, "")
      .trim();
    if (!body || /^(?:answer|response|summary|details|key points|example|sources|references)\s*:?$/i.test(body)) return false;
    const words = body.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
    if (words.length <= 5 && !/[.!?]/.test(body) &&
        words.every((word) => /^[A-Z]/.test(word))) return false;
    return words.length >= 2;
  });
}
