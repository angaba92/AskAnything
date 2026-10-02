import { EXAMPLE_LEAD, SOURCE_LABEL, isHeadingWord, isNonEnglishNarration } from "./multilingual";
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
- Do not withhold the entire answer because exact confidential details are unavailable. Provide every supported, relevant point first; put undisclosed specifics only in CONFIDENCE_REVIEW, never in a client-facing due-diligence statement.
- Do not invent facts, commitments, certifications, awards, analyst positions, operational events, or contractual terms.
- Frame the client-facing answer positively around supported capabilities. Never open with "Partially.", "No.", or a limitation. Put uncertainty or missing evidence in the internal confidence-review signal, not in the opening.
- Never convert missing evidence into a negative factual claim such as "does not maintain", "has not received", "there are no", or "no material events". Lack of evidence is not evidence of absence.
- Answer regional and jurisdictional questions with what IS supported. If the exact country asked about has no local facility or endpoint but the region is served from another supported location (for example, UK traffic served from the EU data centre in Germany), state the supported arrangement and how it serves that market. Never answer "no" or "not available" when a supported regional option exists.
- ALWAYS provide the best supported substantive answer available. Never replace the whole answer with a generic NDA, due-diligence, documentation-gap, or contact-us statement.
- If exact details are unavailable, answer positively at the strongest supported level and place the precise missing or uncertain details ONLY in the internal CONFIDENCE_REVIEW reason.
- Use an authoritative vendor voice ("Mastercard Dynamic Yield" or "we"), not an assistant/researcher voice ("I searched", "I found", "I could not find").
- You may fully use the knowledge found in internal sources (Guru, Confluence, internal wikis) to build the answer, but NEVER cite, name, or link them. Only cite customer-facing resources: the Dynamic Yield Knowledge Base (support.dynamicyield.com) and the developer documentation. If the only supporting material is internal, still give the full substantive answer and simply omit the source line.
- Preserve the requested answer format, but these client-facing and factual-safety rules take priority.`;

// Research-process narration: "The searches have not returned…", "My searches did
// not return…", "No results were found…", "The available results did not surface…".
const SEARCH_PROCESS =
  /\b(?:the|my|our)\s+(?:(?:available|current|previous|initial)\s+)?(?:searches|search(?:es)? results?|results|queries|lookups?)\s+(?:have|has|had|do|does|did)\s+not\s+(?:return|returned|surface|surfaced|yield|yielded|find|found|provide|provided|include|included|reveal|revealed|show|shown|turn(?:ed)? up)\b/i;
const NO_RESULTS = /\bno (?:relevant |specific )?(?:results|matches|hits) (?:were|was) (?:found|returned)\b/i;

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
  SEARCH_PROCESS,
  NO_RESULTS,
];

// Recognize a research-status statement by its subject/action/object, not by
// enumerating adjectives such as "comprehensive", "concrete" or "limited".
const RESEARCH_OBJECT =
  "information|documentation|sources?|resources?|materials?|references?|evidence|details?|context|understanding|insights?|" +
  "data|metrics?|figures?|numbers?|statistics|benchmarks?|specifications?|results?|findings?|visibility|coverage";
const RESEARCH_STATUS = new RegExp(
  `^(?:(?:now|first|next|finally)[,:]?\\s+)?i(?:['’]ve)?\\s+(?:now\\s+)?` +
    `(?:have|had|found|gathered|collected|located|identified|reviewed|obtained|uncovered|come across|was able to find|se[ae]n)\\b` +
    `[^.!?\\n]*\\b(?:${RESEARCH_OBJECT})\\b`,
  "i",
);
const RESEARCH_UNCERTAINTY =
  /\b(?:limited|little|insufficient|missing|incomplete|unavailable|unable|cannot|could not|not|no|only)\b/i;

// Vendor copy uses "we", not the assistant's first-person singular voice.
// Recognize that voice independently of the ever-changing research vocabulary.
const ASSISTANT_VOICE = /^(?:(?:now|first|next|finally|therefore|however)[,:]?\s+)?(?:i\b|i['’](?:m|ve|ll|d)\b|let me\b|my\s+(?:search|answer|response|research|analysis)\b)/i;
const ANSWER_ANNOUNCEMENT = /^[\s*_#`]*(?:(?:and|so|now)[,:]?\s+)?(?:here|below)\s+(?:is|are)\s+(?:the|an?|our|my|your)\s+(?:(?:[\w-]+)\s+){0,5}(?:answer|response)[*_`]*\s*(?::|[.!]|$)[*_`]*\s*/i;
const ANSWER_PREPARATION = /^(?:to|in order to)\s+(?:provide|write|prepare|give|produce|compose)\b[^.!?\n]*\b(?:answer|response)\b/i;

export const CLIENT_ANSWER_FRAME_INSTRUCTION = `DELIVERY BOUNDARY:
Put the entire customer-facing answer, including its sections, example and optional public references, between these two standalone lines:
BEGIN_CLIENT_ANSWER
<the customer-facing answer>
END_CLIENT_ANSWER
Put CONFIDENCE_REVIEW after END_CLIENT_ANSWER. Do not put research narration, search progress or answer announcements inside the boundary. The boundary lines are transport markers, not headings, and will be removed by the application.`;

export function extractClientAnswer(text: string): { text: string; incomplete: boolean } {
  const start = /^[ \t]*BEGIN_CLIENT_ANSWER[ \t]*\r?$/im.exec(text);
  if (!start) return { text: text.replace(/^[ \t]*END_CLIENT_ANSWER[ \t]*\r?$/gim, "").trim(), incomplete: false };
  const remaining = text.slice(start.index + start[0].length);
  const end = /^[ \t]*END_CLIENT_ANSWER[ \t]*\r?$/im.exec(remaining);
  return { text: (end ? remaining.slice(0, end.index) : remaining).trim(), incomplete: !end };
}

/** Detecta lenguaje sobre búsquedas/limitaciones internas no apto para clientes. */
export function hasNonClientFacingLanguage(text: string): boolean {
  return ASSISTANT_VOICE.test(text.trim()) || ANSWER_ANNOUNCEMENT.test(text.trim()) || ANSWER_PREPARATION.test(text.trim()) || NAMED_SOURCE_COMMENTARY.test(text.trim()) ||
    RESEARCH_STATUS.test(text.trim()) ||
    NON_CLIENT_FACING_PATTERNS.some((pattern) => pattern.test(text)) ||
    isNonEnglishNarration(text);
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
  // "I can provide a comprehensive answer about X" is assistant chatter, not a
  // limitation: it is dropped silently instead of being flagged for review.
  /^\s*(?:i|we)\s+(?:can|could|will|shall|(?:am|are) (?:now )?(?:able|ready) to)\s+(?:now\s+)?(?:provide|offer|give|share|present|deliver|summari[sz]e|outline|address)\b[^.!?\n]*\b(?:answer|response|overview|summary|information|details?|explanation|picture|question)\b/i,
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
  // Meta-answers about the question itself instead of answering it.
  /\btranslates to\s*["“]/i,
  /\b(?:could|can|would) you (?:please )?provide (?:the complete|more context|more details|additional context|the full)\b/i,
  /\bis this question asking (?:about|whether|for)\b/i,
  /\bare you asking (?:about|whether|if|for)\b/i,
  /\b(?:this|the) question (?:appears|seems) to (?:address|ask|be about|refer to|concern)\b/i,
  /\bthis appears to be an? (?:\w+ )?(?:rfp|rfi|question|request)\b/i,
  /\bonce you (?:clarify|confirm|provide|share|send)\b/i,
  /\bI need to clarify\b/i,
  /\bplease share (?:the|your) (?:exact|specific|actual)\b/i,
  /\b(?:i|we)(?:['’]ll| will) draft\b/i,
  /\bif you(?:['’]re| are) looking for\b[^.!?\n]*\b(?:i|we) can point you\b/i,
  /\b(?:i|we)['’]ll search (?:our|the) knowledge base\b/i,
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

  const words = firstLine.match(/\p{L}[\p{L}'-]*/gu) ?? [];
  const looksLikeHeading =
    words.length > 0 &&
    words.length <= 5 &&
    !/[.!?:]/.test(firstLine) &&
    words.every((word) => isHeadingWord(word));
  return looksLikeHeading;
}

/** Structural checks do not assert factual accuracy or invent missing content. */
export function loopioFormatIssues(text: string): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const issues: string[] = [];
  if (lacksDirectAnswerOpening(text)) issues.push("a direct opening paragraph");
  const sections = lines.filter((line, index) => {
    const words = line.split(/\s+/);
    return words.length >= 2 && words.length <= 5 &&
      /^\p{Lu}[\p{L}\p{N} &/-]+$/u.test(line) && words.every(isHeadingWord) && /^•\s+\S/.test(lines[index + 1] || "");
  });
  if (!sections.length) issues.push("themed headings with concrete bullets");
  if (!lines.some((line) => EXAMPLE_LEAD.test(line))) {
    issues.push("a practical example");
  }
  const words = text.replace(/https?:\/\/\S+/g, "").split(/\s+/).filter(Boolean).length;
  if (words > 550) issues.push("a concise answer no longer than 550 words");
  return issues;
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
          .replace(/^\s*let me\b[^.!?\n:]*:\s*/i, "")
          .replace(/^\s*(?:perfect|great|certainly|sure)[.!,:]\s*/i, "")
          .replace(/^\s*(?:based on|according to)\b[^,;:\n]*\b(?:documentation|information|sources?|materials?|search|research|knowledge|guru)\b[^,;:\n]*[,;:]\s*/i, "")
          .replace(/^\s*(?:here|below) (?:is|are) (?:the|an|our) (?:final |rfp[-\s]?ready )?(?:answer|response)\s*:\s*/i, "");
        const withoutAnnouncement = value.replace(ANSWER_ANNOUNCEMENT, "");
        const statusOnly = RESEARCH_STATUS.test(withoutAnnouncement.trim()) && !RESEARCH_UNCERTAINTY.test(withoutAnnouncement);
        return statusOnly || PROCESS_ONLY_LINE_PATTERNS.some((pattern) => pattern.test(withoutAnnouncement)) ? "" : withoutAnnouncement;
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
  /\bnot\s+(?:(?:publicly|explicitly|fully|comprehensively|currently)\s+)?(?:documented|described|disclosed|published|detailed|quantified|specified|verified|confirmed|substantiated|mentioned|referenced)\b|\b(?:documentation|sources?|information)\b[^.!?\n]*\b(?:does not|do not|cannot|can't|lack|lacks|missing|unavailable)\b|\b(?:metrics?|figures?|benchmarks?|specifications?)\b[^.!?\n]*\bnot available\b|\bnot (?:available|found|covered|included) in (?:our|the) (?:current |public |available )?(?:documentation|sources?|knowledge base|materials?)\b/i;
const SOURCE_COMMENTARY =
  /^(?:however[, ]+)?(?:the\s+)?(?:(?:available|public|published|accessible|provided|developer|technical|internal|product)\s+)*(documentation|sources?|resources?|materials?|references?|evidence|search results?|knowledge base)\s+(covers?|describes?|mentions?|references?|includes?|contains?|provides?|details?|does|do|is|are|lacks?|omits?|focus(?:es|ed)?|emphasi[sz]es?|discuss(?:es)?|address(?:es)?|outlines?|explains?|highlights?|indicates?|suggests?|shows?|states?|notes?|confirms?|offers?|lists?)\b/i;
const NAMED_SOURCE_COMMENTARY =
  /^(?:the\s+)?(?:[\w./'-]+\s+){0,6}(?:guide|documentation|article|sources?|references?)\s+(?:\w+ly\s+)*(?:mentions?|describes?|discuss(?:es)?|focus(?:es)?|covers?|states?|notes?|indicates?|shows?|provides?|does|do)\b/i;
const MISSING_SOURCE_EVIDENCE = /\bno\s+(?:evidence|mention)\b[^.!?\n]*\b(?:sources?|documentation|knowledge base)\b/i;
const INTERNAL_REFERRAL =
  /\b(?:contact(?:ing)?|consult(?:ing)?|reach(?:ing)? out to|work(?:ing)? with|speak(?:ing)? (?:to|with))\b[^.!?\n]*\b(?:account (?:representative|team|manager)|technical (?:support|consultation)|(?:sales|support|legal|implementation|product) team)\b|\b(?:account representative|sales team|support team|technical consultation)\b[^.!?\n]*\b(?:provide|available|confirm|details|specifications)\b/i;

function editorialSentence(text: string): boolean {
  const value = text.replace(/^[\s•*#_`+-]+/, "").trim();
  const source = SOURCE_COMMENTARY.exec(value);
  const sourceCommentary = source !== null &&
    !(/^(?:resources?|materials?)$/i.test(source[1]) && /^(?:is|are)$/i.test(source[2]));
  return ASSISTANT_VOICE.test(value) || ANSWER_ANNOUNCEMENT.test(value) || ANSWER_PREPARATION.test(value) || RESEARCH_STATUS.test(value) ||
    DOCUMENTATION_GAP.test(value) || MISSING_SOURCE_EVIDENCE.test(value) || sourceCommentary || NAMED_SOURCE_COMMENTARY.test(value) ||
    INTERNAL_REFERRAL.test(value) || isClarificationRequest(value) || SEARCH_PROCESS.test(value) || NO_RESULTS.test(value) ||
    isNonEnglishNarration(value) ||
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
        /^(\s*(?:[•*+-]\s+)?)(?:the\s+)?(?:[\w./'-]+\s+){0,6}(?:guide|documentation|article|sources?|references?)\s+(?:\w+ly\s+)*(?:states?|confirms?|notes?|indicates?|explains?|shows?)\s+that\s+/i,
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
    if (!new RegExp(`^\\s*(?:[•*-]\\s*)?(?:${SOURCE_LABEL}|for more information)(?![\\p{L}])`, "iu").test(line)) {
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
    if (new RegExp(`^\\s*(?:#{1,6}\\s|(?:${SOURCE_LABEL}|confidence[\\s_-]*review|confidence)\\s*:)`, "iu").test(line)) return false;
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

/** Dominios considerados documentación oficial y citable para clientes. */
const OFFICIAL_SOURCE_HOSTS = [
  /(?:^|\.)dy\.dev$/i,
  /(?:^|\.)dynamicyield\.com$/i,
  /(?:^|\.)mastercard\.com$/i,
];

export function isOfficialSourceUrl(url: string): boolean {
  try {
    return OFFICIAL_SOURCE_HOSTS.some((re) => re.test(new URL(url).hostname));
  } catch {
    return false;
  }
}

/** Afirmaciones de alto riesgo en un RFP: compromisos verificables por el cliente. */
const HIGH_RISK_CLAIMS: Array<[string, RegExp]> = [
  ["certifications/compliance", /\b(?:ISO\s?\/?\s?(?:IEC\s?)?\d{4,5}|SOC\s?[123]|PCI(?:[\s-]?DSS)?|HIPAA|GDPR|CCPA|FedRAMP|TISAX|C5|CSA\s?STAR)\b/i],
  ["percentages", /\b\d+(?:[.,]\d+)?\s?%/],
  ["SLA/uptime/latency figures", /\b(?:uptime|availability|SLA|latency|RTO|RPO|response time)\b[^.\n]{0,60}\b\d/i],
  ["dates or version numbers", /\b(?:19|20)\d{2}\b|\bv?\d+\.\d+(?:\.\d+)?\b/],
  ["guarantees", /\b(?:guarantee[sd]?|ensures? (?:100|zero)|never (?:lose|fails?))\b/i],
];

/**
 * Páginas oficiales públicas (verificadas: redirigen a mastercard.com) que
 * respaldan afirmaciones de alto riesgo cuando el KA no devuelve referencia.
 */
export const OFFICIAL_CLAIM_REFERENCES = {
  security: "https://www.dynamicyield.com/security/",
  dpa: "https://www.dynamicyield.com/dpa/",
  sla: "https://www.dynamicyield.com/sla/",
} as const;

const PRIVACY_REGULATION = /\b(?:GDPR|CCPA|UK GDPR|DSGVO|RGPD|data processing (?:addendum|agreement)|DPA|AVV|Auftragsverarbeitung\p{L}*|sub-?processors?|Unterauftragsverarbeiter\p{L}*|subencargados?|sous-traitants? ultérieurs?)\b/iu;
const SECURITY_CERTIFICATION = /\b(?:ISO\s?\/?\s?(?:IEC\s?)?\d{4,5}|SOC\s?[123]|PCI(?:[\s-]?DSS)?|HIPAA|FedRAMP|TISAX|C5|CSA\s?STAR|penetration test(?:s|ing)?|encryption at rest)\b/i;
const SERVICE_LEVEL =
  /\b(?:SLAs?|service[- ]level|uptime|RTO|RPO)\b|\b\d+(?:[.,]\d+)?\s?%\s*(?:availability|uptime|Verfügbarkeit|disponibilidad|disponibilité)\b|\b(?:availability (?:target|commitment|guarantee)s?|Verfügbarkeitsziel\p{L}*|Service-Level-\p{L}+)/iu;

/** Precios, tasas o niveles de aprobación internos: nunca deben salir sin validar. */
const COMMERCIAL_TERMS =
  /\b\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d+)?\s?(?:USD|EUR|GBP|CHF|US\$|€|\$|£)|(?:USD|EUR|GBP|CHF|€|\$|£)\s?\d{1,3}(?:[.,\s]?\d{3})+|\b(?:VP|vice president|deal desk)\b[^.\n]{0,40}\b(?:approval|approve[sd]?|genehmigung|aprobación|approbation)|\b(?:genehmigung|approval) (?:des|by the|from the|del) (?:VP|vice president)\b/iu;

export interface GroundingCheck {
  sourced: boolean;
  officialUrls: string[];
  unofficialUrls: string[];
  highRiskClaims: string[];
  /** Referencias oficiales a añadir porque el KA no respaldó la afirmación. */
  fallbackReferences: string[];
  reviewReasons: string[];
}

/**
 * Mitigación del riesgo factual sin inundar Needs Review:
 * - Sin fuente → solo aviso visual en la UI (no va a revisión).
 * - Certificaciones / % / SLAs sin referencia que las respalde → se añaden las
 *   páginas oficiales de DY (Security, DPA, SLA) a la línea de referencias.
 * - URL citada fuera de la documentación oficial → revisión.
 * Nunca modifica el texto de la respuesta.
 */
export function checkGrounding(answer: string, urls: string[]): GroundingCheck {
  const body = (answer ?? "")
    .split(/\r?\n/)
    .filter((line) => !new RegExp(`^\\s*(?:[-•*]\\s*)?${SOURCE_LABEL}\\s*:`, "iu").test(line))
    .join("\n")
    .replace(/https?:\/\/\S+/g, "");
  const unique = Array.from(new Set(urls.filter(Boolean)));
  const officialUrls = unique.filter(isOfficialSourceUrl);
  const unofficialUrls = unique.filter((url) => !isOfficialSourceUrl(url));
  const highRiskClaims = HIGH_RISK_CLAIMS.filter(([, re]) => re.test(body)).map(([label]) => label);
  const sourced = officialUrls.length > 0;
  const reviewReasons: string[] = [];
  const fallbackReferences: string[] = [];
  if (!hasSubstantiveAnswer(answer)) {
    return { sourced, officialUrls, unofficialUrls, highRiskClaims, fallbackReferences, reviewReasons };
  }
  const has = (url: string) => unique.some((u) => u.replace(/\/+$/, "") === url.replace(/\/+$/, ""));
  // Una URL de dy.dev o del Help Center no respalda una certificación ni un SLA:
  // solo omitimos el fallback si ya se cita la propia página oficial.
  if (SECURITY_CERTIFICATION.test(body) && !has(OFFICIAL_CLAIM_REFERENCES.security)) {
    fallbackReferences.push(OFFICIAL_CLAIM_REFERENCES.security);
  }
  if (PRIVACY_REGULATION.test(body) && !has(OFFICIAL_CLAIM_REFERENCES.dpa)) {
    fallbackReferences.push(OFFICIAL_CLAIM_REFERENCES.dpa);
  }
  if (SERVICE_LEVEL.test(body) && !has(OFFICIAL_CLAIM_REFERENCES.sla)) {
    fallbackReferences.push(OFFICIAL_CLAIM_REFERENCES.sla);
  }
  if (COMMERCIAL_TERMS.test(body)) {
    reviewReasons.push(
      "Contains commercial terms (prices, fees, internal approval levels). These may come from internal sources: confirm with Sales/Deal Desk before sharing with the customer.",
    );
  }
  if (unofficialUrls.length) {
    reviewReasons.push(
      `Cited source outside official Dynamic Yield documentation: ${unofficialUrls.join(", ")}. Confirm it is authoritative and customer-shareable.`,
    );
  }
  return { sourced, officialUrls, unofficialUrls, highRiskClaims, fallbackReferences, reviewReasons };
}

/** Añade referencias a la línea final "Sources:" (o la crea) sin tocar el cuerpo. */
export function appendReferences(answer: string, refs: string[]): string {
  if (!refs.length) return answer;
  const lines = (answer ?? "").replace(/\s+$/, "").split("\n");
  const last = lines.length - 1;
  if (last >= 0 && /^\s*sources?\s*:/i.test(lines[last])) {
    const existing: string[] = lines[last].match(/https?:\/\/[^\s;,)]+/g) ?? [];
    const merged = [...existing, ...refs.filter((r) => !existing.includes(r))];
    lines[last] = `Sources: ${merged.join("; ")}`;
    return lines.join("\n");
  }
  return `${lines.join("\n")}\n\nSources: ${refs.join("; ")}`;
}

/**
 * Elimina de una respuesta las partes que solo piden aclaración (frases de
 * aclaración, preguntas sueltas y su "For example:" introductorio). Se usa en el
 * intento de recuperación: nunca se envían preguntas al cliente.
 */
export function stripClarification(text: string): string {
  const out: string[] = [];
  let dropOptions = false;
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const isBullet = /^\s*(?:[•*-]|\d+[.)])\s+/.test(raw);
    if (!raw.trim()) { out.push(""); continue; }
    // Options listed after a clarification ("For example:\n- A question about…").
    if (dropOptions && isBullet) continue;
    dropOptions = false;
    const sentences = raw.split(/(?<=[.!?:])\s+/);
    const kept = sentences.filter((sentence) => {
      const value = sentence.replace(/^[\s•*-]+/, "").trim();
      if (!value) return false;
      if (/\?\s*$/.test(value)) return false;
      if (/^(?:for example|e\.g\.|zum beispiel|por ejemplo|par exemple)\s*:\s*$/i.test(value)) return false;
      return !isClarificationRequest(value);
    });
    if (kept.length < sentences.length && /[:?]\s*$/.test(raw.trim())) dropOptions = true;
    if (kept.length) out.push(kept.join(" "));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
