//#region src/multilingualLexicon.ts
const WORD_SEGMENTER = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(void 0, { granularity: "word" }) : null;
const WORDLIKE_FALLBACK_RE = /[\p{L}\p{N}_.:+#\/-]+/gu;
const CJK_FAMILY_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK_FAMILY_ONLY_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u;
function hasCjkFamilyScript(value) {
	return CJK_FAMILY_RE.test(value);
}
function isCjkFamilyToken(value) {
	return CJK_FAMILY_ONLY_RE.test(value);
}
function wordLikeSegments(value) {
	if (!value) return [];
	if (!WORD_SEGMENTER) return value.match(WORDLIKE_FALLBACK_RE) ?? [];
	const segments = [];
	for (const segment of WORD_SEGMENTER.segment(value)) if (segment.isWordLike) segments.push(segment.segment);
	return segments;
}
function expandCjkFamilySubwords(token) {
	if (!isCjkFamilyToken(token) || token.length <= 2) return [token];
	const windows = new Set([token]);
	for (let size = 2; size <= Math.min(3, token.length); size += 1) for (let index = 0; index <= token.length - size; index += 1) windows.add(token.slice(index, index + size));
	return [...windows];
}
//#endregion
export { expandCjkFamilySubwords, hasCjkFamilyScript, wordLikeSegments };
