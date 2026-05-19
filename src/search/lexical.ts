import { normalizeText, normalizedTerms } from "../support.js";

const SEARCH_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "do",
  "does",
  "i",
  "is",
  "of",
  "on",
  "the",
  "to",
  "was",
  "what",
]);

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export function lexicalSearchTerms(text: string, maxTerms = 64): string[] {
  return normalizedTerms(text, {
    stopwords: SEARCH_STOPWORDS,
    minLength: 2,
  }).slice(0, Math.max(1, maxTerms));
}

export function hasCjkLexicalTerms(text: string): boolean {
  return lexicalSearchTerms(text).some((term) => CJK_RE.test(term));
}

export function buildLexicalSearchText(text: string): string {
  const normalized = normalizeText(text);
  const terms = lexicalSearchTerms(text, 512);
  return [normalized, ...terms].filter(Boolean).join(" ");
}

function escapeFtsPhrase(term: string): string {
  return term.replaceAll('"', '""');
}

export function buildFtsMatchQuery(query: string): string {
  const terms = lexicalSearchTerms(query);
  if (terms.length === 0) {
    return query.trim();
  }
  return terms.map((term) => `"${escapeFtsPhrase(term)}"`).join(" OR ");
}
