import { clamp01, orderByScore } from "../../support.mjs";
//#region src/search/backends/hybrid.ts
const RRF_K = 60;
const MMR_LAMBDA = .72;
const RECENCY_HALF_LIFE_DAYS = 21;
function tokenize(text) {
	return text.toLowerCase().match(/[\p{L}\p{N}_.:-]+/gu)?.filter((token) => token.length > 1) ?? [];
}
function lexicalSimilarity(left, right) {
	const leftTokens = new Set(tokenize(left));
	const rightTokens = new Set(tokenize(right));
	if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
	let overlap = 0;
	for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
	return overlap / Math.max(Math.min(leftTokens.size, rightTokens.size), 1);
}
function recencyDecay(observedAt) {
	if (typeof observedAt !== "string") return 1;
	const ts = new Date(observedAt).getTime();
	if (!Number.isFinite(ts)) return 1;
	const ageDays = Math.max(0, (Date.now() - ts) / (1440 * 60 * 1e3));
	if (ageDays <= .5) return 1;
	return Math.pow(.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}
function reciprocalRankFuse(lists) {
	const fused = /* @__PURE__ */ new Map();
	for (const hits of lists) for (const [index, hit] of hits.entries()) {
		const score = fused.get(hit.docId) ?? 0;
		fused.set(hit.docId, score + 1 / (RRF_K + index + 1));
	}
	return fused;
}
function mmrRerank(query, hits, limit) {
	const remaining = [...hits];
	const selected = [];
	while (remaining.length > 0 && selected.length < limit) {
		let bestIndex = 0;
		let bestScore = -Infinity;
		for (const [index, hit] of remaining.entries()) {
			const relevance = Math.max(hit.score, lexicalSimilarity(query, hit.text));
			const noveltyPenalty = selected.length ? Math.max(...selected.map((chosen) => lexicalSimilarity(chosen.text, hit.text))) : 0;
			const score = MMR_LAMBDA * relevance - (1 - MMR_LAMBDA) * noveltyPenalty;
			if (score > bestScore) {
				bestScore = score;
				bestIndex = index;
			}
		}
		selected.push(remaining.splice(bestIndex, 1)[0]);
	}
	return selected;
}
function mergeHybridHits(query, keywordHits, similarityHits, limit) {
	if (keywordHits.length === 0) return orderByScore(similarityHits).slice(0, Math.max(1, limit));
	if (similarityHits.length === 0) return orderByScore(keywordHits).slice(0, Math.max(1, limit));
	const fusedScores = reciprocalRankFuse([keywordHits, similarityHits]);
	const merged = /* @__PURE__ */ new Map();
	for (const hit of [...keywordHits, ...similarityHits]) {
		const existing = merged.get(hit.docId);
		const baseScore = fusedScores.get(hit.docId) ?? hit.score;
		const rescored = {
			...hit,
			backend: "hybrid",
			score: baseScore * recencyDecay(hit.metadata.observedAt)
		};
		if (!existing || rescored.score > existing.score) merged.set(hit.docId, rescored);
	}
	const reranked = mmrRerank(query, orderByScore([...merged.values()]).slice(0, Math.max(limit * 4, 12)), Math.max(limit * 2, limit));
	const topScore = reranked[0]?.score ?? 1;
	return reranked.slice(0, Math.max(1, limit)).map((hit) => ({
		...hit,
		score: clamp01(hit.score / topScore)
	}));
}
//#endregion
export { mergeHybridHits };
