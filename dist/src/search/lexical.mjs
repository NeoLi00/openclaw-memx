import { normalizeText, normalizedTerms } from "../support.mjs";
//#region src/search/lexical.ts
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
	"what"
]);
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
function lexicalSearchTerms(text, maxTerms = 64) {
	return normalizedTerms(text, {
		stopwords: SEARCH_STOPWORDS,
		minLength: 2
	}).slice(0, Math.max(1, maxTerms));
}
function hasCjkLexicalTerms(text) {
	return lexicalSearchTerms(text).some((term) => CJK_RE.test(term));
}
function buildLexicalSearchText(text) {
	return [normalizeText(text), ...lexicalSearchTerms(text, 512)].filter(Boolean).join(" ");
}
function escapeFtsPhrase(term) {
	return term.replaceAll("\"", "\"\"");
}
function buildFtsMatchQuery(query) {
	const terms = lexicalSearchTerms(query);
	if (terms.length === 0) return query.trim();
	return terms.map((term) => `"${escapeFtsPhrase(term)}"`).join(" OR ");
}
//#endregion
export { buildFtsMatchQuery, buildLexicalSearchText, hasCjkLexicalTerms, lexicalSearchTerms };
