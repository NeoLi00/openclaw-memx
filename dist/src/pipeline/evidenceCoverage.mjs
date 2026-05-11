import { normalizeText } from "../support.mjs";
//#region src/pipeline/evidenceCoverage.ts
function queryAnswerMode(queryAnalysis) {
	return queryAnalysis.answerMode ?? "single_fact";
}
function uniqueAnchors(values) {
	const seen = /* @__PURE__ */ new Set();
	const result = [];
	for (const value of values) {
		const trimmed = value.trim();
		const key = normalizeText(trimmed);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		result.push(trimmed);
	}
	return result;
}
function anchorMatches(text, anchor) {
	const normalizedText = normalizeText(text);
	const normalizedAnchor = normalizeText(anchor);
	if (!normalizedText || !normalizedAnchor) return false;
	const anchorTokens = normalizedAnchor.split(/[^\p{L}\p{N}']+/u).map((token) => token.trim()).filter((token) => token.length >= 2);
	if (anchorTokens.length === 0) return false;
	const textTokenSet = new Set(normalizedText.split(/[^\p{L}\p{N}']+/u).map((token) => normalizeText(token)).filter(Boolean));
	return anchorTokens.every((token) => textTokenSet.has(normalizeText(token)));
}
function evidenceCoverageForText(queryAnalysis, text) {
	const requiredAnchors = uniqueAnchors(queryAnalysis.evidenceCoverage?.requiredAnchors ?? []);
	if (requiredAnchors.length === 0) return {
		requiredHits: [],
		missingRequired: [],
		coverageScore: 1,
		answerMode: queryAnswerMode(queryAnalysis)
	};
	const requiredHits = requiredAnchors.filter((anchor) => anchorMatches(text, anchor));
	return {
		requiredHits,
		missingRequired: requiredAnchors.filter((anchor) => !requiredHits.includes(anchor)),
		coverageScore: requiredHits.length / requiredAnchors.length,
		answerMode: queryAnswerMode(queryAnalysis)
	};
}
function capScoreByEvidenceCoverage(score, coverage) {
	if (coverage.missingRequired.length === 0) return score;
	if (score >= .62) return Math.min(score, coverage.requiredHits.length > 0 ? .72 : .66);
	if (score >= .52) return Math.min(score, coverage.requiredHits.length > 0 ? .58 : .46);
	if (coverage.requiredHits.length === 0) return Math.min(score, .24);
	if (coverage.answerMode === "count_aggregate" || coverage.answerMode === "multi_evidence") return Math.min(score, .52);
	return Math.min(score, .34);
}
//#endregion
export { capScoreByEvidenceCoverage, evidenceCoverageForText };
