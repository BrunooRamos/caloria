/**
 * Red de seguridad del comentario (RNF-10): términos sobre el cuerpo, el peso, la apariencia o
 * la restricción. El control principal es el prompt (prompts/roast.md); esto descarta lo que se
 * le escape. Sin tildes y en minúsculas; con "*" al final, cualquier palabra que empiece así.
 */
export const BLOCKED_TERMS = [
  "peso",
  "kilos",
  "kilitos",
  "balanza",
  "engord*",
  "adelgaz*",
  "gord*",
  "flac*",
  "panza",
  "rollitos",
  "cuerpo",
  "figura",
  "silueta",
  "apariencia",
  "culpa*",
  "culpos*",
  "compens*",
  "te pasaste",
  "saltear",
  "salteate",
  "salteala",
  "ayuno",
  "dieta",
  "quemar*",
] as const;

const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const BLOCKED = new RegExp(
  `\\b(?:${BLOCKED_TERMS.map((term) =>
    term.endsWith("*") ? `${term.slice(0, -1)}\\w*` : term.replace(/ /g, "\\s+"),
  ).join("|")})\\b`,
);

/** true si el texto menciona alguno de los términos prohibidos. */
export function isBlockedComment(text: string): boolean {
  return BLOCKED.test(normalize(text));
}
