/**
 * Soporte multilingüe (EN, DE, ES, FR, IT, PT, NL). El KA responde en el idioma
 * de la pregunta; estas expresiones permiten que las comprobaciones de formato y
 * los filtros de narración interna funcionen también fuera del inglés.
 */

/** Instrucción de idioma para el KA (marcadores internos siempre en inglés). */
export const LANGUAGE_INSTRUCTION =
  'LANGUAGE: answer in the language of the question. Keep product/API names, URLs, internal markers and the "Sources:" label in English.';

/** Frase que introduce el ejemplo práctico. */
export const EXAMPLE_LEAD =
  /^(?:•\s*)?(?:(?:for|as an) example|(?:a )?practical example|example\s*:|zum beispiel|beispielsweise|ein beispiel|als beispiel|(?:praktisches |konkretes )?beispiel\b|für beispielsweise|por ejemplo|como ejemplo|a modo de ejemplo|(?:ejemplo )?práctico|ejemplo\s*:|par exemple|à titre d['’]exemple|exemple (?:pratique|concret)|exemple\s*:|ad esempio|per esempio|esempio(?: pratico)?\s*:?|por exemplo|como exemplo|exemplo(?: prático)?\s*:?|bijvoorbeeld|(?:praktisch )?voorbeeld\s*:?)(?=[\s,:]|$)/iu;

/** Frase que introduce las referencias para más información. */
export const MORE_INFO_LEAD =
  /^(?:for more information|weitere informationen|für weitere informationen|mehr informationen|para más información|para obtener más información|pour plus d['’]informations|per maggiori informazioni|para mais informações|voor meer informatie)\b/iu;

/** Etiqueta de la línea de fuentes en cualquier idioma soportado. */
export const SOURCE_LABEL = "(?:sources?|references?|quellen?|referenzen|fuentes?|referencias|r[ée]f[ée]rences?|fonti|fontes?|bronnen?)";

/** Palabras conectoras admitidas dentro de un encabezado temático corto. */
export const HEADING_CONNECTORS = new Set([
  "and", "or", "for", "of", "the", "in", "to", "&",
  "und", "oder", "für", "von", "der", "die", "das", "im", "mit", "zur", "zum",
  "y", "o", "de", "del", "la", "el", "los", "las", "para", "en", "con",
  "et", "ou", "des", "du", "le", "les", "pour", "et",
  "e", "di", "per", "il", "da",
  "en", "van", "voor", "het", "met",
]);

export function isHeadingWord(word: string): boolean {
  return HEADING_CONNECTORS.has(word) || /^\p{Lu}[\p{L}\p{N}/-]*$/u.test(word);
}

/**
 * Narración interna / de búsqueda en alemán, español, francés, italiano,
 * portugués y neerlandés. Igual que en inglés: se retira de la respuesta al
 * cliente y pasa a Needs Review.
 */
export const NON_ENGLISH_NARRATION: RegExp[] = [
  // Alemán
  /\b(?:ich|wir) (?:habe|haben) (?:keine|nicht|nur begrenzte)\b[^.!?\n]*\b(?:gefunden|finden|informationen)(?![\p{L}\p{N}])/iu,
  /\b(?:basierend auf|auf grundlage) (?:meiner|unserer|der) (?:suche|recherche)(?![\p{L}\p{N}])/iu,
  /\b(?:meine|unsere|die) (?:suche|recherche|suchergebnisse?)\b[^.!?\n]*\b(?:ergab|ergaben|lieferte|lieferten|enthält|enthalten|zeigt|zeigen)\b[^.!?\n]*\b(?:keine|nicht)(?![\p{L}\p{N}])/iu,
  /\b(?:nicht|keine) (?:öffentlich |explizit |ausreichend )?(?:dokumentiert|dokumentation|belegt|verfügbar in (?:der|den) (?:dokumentation|quellen))(?![\p{L}\p{N}])/iu,
  /\b(?:die )?(?:verfügbaren|vorliegenden|öffentlichen) (?:quellen|dokumentationen?|informationen)\b[^.!?\n]*\b(?:keine|nicht)(?![\p{L}\p{N}])/iu,
  /\b(?:wenden sie sich|kontaktieren sie)\b[^.!?\n]*\b(?:account|vertrieb|ansprechpartner|kundenbetreuer|team)(?![\p{L}\p{N}])/iu,
  /^(?:hier ist|nachfolgend (?:finden sie|die)|im folgenden)\b[^.!?\n]*\b(?:antwort|stellungnahme)(?![\p{L}\p{N}])/iu,
  // Español
  /\b(?:he|hemos) (?:buscado|revisado|consultado)(?![\p{L}\p{N}])/iu,
  /\b(?:no (?:he|hemos) (?:encontrado|podido encontrar|localizado))(?![\p{L}\p{N}])/iu,
  /\b(?:según|basado en|basándome en) (?:mi|nuestra|la) (?:búsqueda|investigación)(?![\p{L}\p{N}])/iu,
  /\bno (?:está|están|se encuentra|se encuentran) (?:públicamente |explícitamente )?(?:documentad[oa]s?|disponibles? en (?:la|las) (?:documentación|fuentes))(?![\p{L}\p{N}])/iu,
  /\b(?:las )?fuentes (?:disponibles|consultadas)\b[^.!?\n]*\bno(?![\p{L}\p{N}])/iu,
  /\b(?:contacte|póngase en contacto|consulte) con (?:su|el|nuestro) (?:representante|equipo|gestor)(?![\p{L}\p{N}])/iu,
  /^(?:aquí (?:está|tiene)|a continuación (?:se presenta|encontrará))\b[^.!?\n]*\brespuesta(?![\p{L}\p{N}])/iu,
  // Francés
  /\b(?:j['’]ai|nous avons) (?:recherché|cherché|consulté)(?![\p{L}\p{N}])/iu,
  /\b(?:je n['’]ai|nous n['’]avons) pas (?:trouvé|pu trouver)(?![\p{L}\p{N}])/iu,
  /\bn['’](?:est|sont) pas (?:publiquement |explicitement )?(?:documenté|documentée|documentés|documentées)(?![\p{L}\p{N}])/iu,
  /\b(?:contactez|veuillez contacter) (?:votre|notre) (?:représentant|équipe|interlocuteur)(?![\p{L}\p{N}])/iu,
  /^(?:voici|ci-dessous)\b[^.!?\n]*\bréponse(?![\p{L}\p{N}])/iu,
  // Italiano / Portugués / Neerlandés (formas más frecuentes)
  /\bnon (?:ho|abbiamo) trovato\b|\bnon (?:è|sono) (?:documentat[oaie])(?![\p{L}\p{N}])/iu,
  /\bnão (?:encontrei|encontramos)\b|\bnão (?:está|estão) documentad[oa]s?(?![\p{L}\p{N}])/iu,
  /\b(?:ik heb|wij hebben) geen\b[^.!?\n]*\bgevonden\b|\bniet gedocumenteerd(?![\p{L}\p{N}])/iu,
];

export function isNonEnglishNarration(text: string): boolean {
  return NON_ENGLISH_NARRATION.some((pattern) => pattern.test(text ?? ""));
}

const LANGUAGE_MARKERS: Array<[string, RegExp]> = [
  ["German", /\b(?:und|der|die|das|nicht|wird|werden|können|kann|ist|sind|mit|für|über|bei|auch|einer?|unsere?|eure?|welche|wie|gibt|es)\b|[äöüß]/giu],
  ["Spanish", /\b(?:el|la|los|las|que|para|con|una?|es|son|cómo|qué|puede|pueden|nuestro|nuestra|del|se)\b|[ñ¿¡]/giu],
  ["French", /\b(?:le|la|les|des|est|sont|pour|avec|une?|que|quels?|quelles?|comment|pouvez|nous|vous|du|au)\b|[çœ]/giu],
  ["Italian", /\b(?:il|lo|gli|che|per|con|una?|sono|come|quali|può|possono|nostro|nostra|della|degli)\b/giu],
  ["Portuguese", /\b(?:o|os|as|que|para|com|uma?|são|como|quais|pode|podem|nosso|nossa|não|dos|das)\b|[ãõ]/giu],
  ["Dutch", /\b(?:de|het|een|en|niet|wordt|worden|kan|kunnen|zijn|met|voor|onze|hoe|welke|ook)\b|ij\b/giu],
];
const ENGLISH_MARKERS = /\b(?:the|and|is|are|can|does|do|what|which|how|with|for|our|your|of|to|in)\b/giu;

/** Idioma probable de la pregunta (null = inglés o indeterminado). */
export function detectQuestionLanguage(text: string): string | null {
  const value = (text ?? "").toLowerCase();
  const english = value.match(ENGLISH_MARKERS)?.length ?? 0;
  let best: [string, number] | null = null;
  for (const [language, pattern] of LANGUAGE_MARKERS) {
    const score = value.match(pattern)?.length ?? 0;
    if (!best || score > best[1]) best = [language, score];
  }
  if (!best || best[1] === 0) {
    // Fragmentos cortos ("Pilot: variable Kosten"): sustantivos compuestos alemanes.
    return /(?:^|[\s:/(])(?:\p{L}*(?:kosten|laufzeit|vertrag|kontingent|anforderung\p{L}*|anbindung|einwilligung|datenschutz|bedienung|vollversion))(?=$|[\s/:,.?)])/iu.test(text ?? "") ? "German" : null;
  }
  return best[1] > english ? best[0] : null;
}

/** Instrucción obligatoria de idioma, colocada al final del prompt (recencia). */
export function answerLanguageInstruction(language: string | null): string {
  if (!language) return "";
  return `MANDATORY OUTPUT LANGUAGE: the question is in ${language}. Write the ENTIRE client-facing answer (opening, headings, bullets, example) in ${language}. Do not answer in English. Only BEGIN_CLIENT_ANSWER, END_CLIENT_ANSWER, CONFIDENCE_REVIEW and the "Sources:" label stay in English.`;
}

/** Cuenta aproximada de marcadores ingleses vs. del idioma esperado. */
export function looksEnglish(text: string, language: string): boolean {
  const body = (text ?? "").replace(/https?:\/\/\S+/g, "").toLowerCase();
  const pattern = LANGUAGE_MARKERS.find(([name]) => name === language)?.[1];
  if (!pattern) return false;
  const english = body.match(ENGLISH_MARKERS)?.length ?? 0;
  const expected = body.match(pattern)?.length ?? 0;
  return english >= 8 && english > expected * 2;
}
