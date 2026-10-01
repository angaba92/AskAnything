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
  /^(?:(?:for|as an) example|zum beispiel|beispielsweise|ein beispiel|als beispiel|por ejemplo|como ejemplo|a modo de ejemplo|par exemple|à titre d['’]exemple|ad esempio|per esempio|por exemplo|como exemplo|bijvoorbeeld)(?=[\s,:])/iu;

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
