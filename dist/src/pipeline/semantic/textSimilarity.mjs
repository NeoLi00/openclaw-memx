import { clamp01, normalizeText, normalizedTerms } from "../../support.mjs";
import { tokenizeSearchTerms } from "./heuristics.mjs";
//#region src/pipeline/semantic/textSimilarity.ts
const LABEL_VALUE_RE = /^\s*([^:\n]{2,48}):\s+(.+)$/u;
const GRAPH_REL_RE = /--([a-z_]+)-->/giu;
function extractTokens(value) {
	return normalizedTerms(value, { minLength: 2 });
}
function compactText(value) {
	return normalizeText(value).replace(/[^\p{L}\p{N}]+/gu, "");
}
function toSparseTf(features) {
	const counts = /* @__PURE__ */ new Map();
	for (const feature of features) counts.set(feature, (counts.get(feature) ?? 0) + 1);
	for (const [feature, count] of counts) counts.set(feature, 1 + Math.log1p(count));
	return counts;
}
function buildTokenBigrams(tokens) {
	if (tokens.length < 2) return [];
	const bigrams = [];
	for (let index = 0; index < tokens.length - 1; index += 1) bigrams.push(`${tokens[index]}\u0001${tokens[index + 1]}`);
	return bigrams;
}
function buildCharNgrams(value, n) {
	const compact = compactText(value);
	if (!compact) return [];
	if (compact.length <= n) return [compact];
	const grams = [];
	for (let index = 0; index <= compact.length - n; index += 1) grams.push(compact.slice(index, index + n));
	return grams;
}
function cosineFromSparse(left, right) {
	if (left.size === 0 || right.size === 0) return 0;
	let dot = 0;
	let leftNorm = 0;
	let rightNorm = 0;
	for (const value of left.values()) leftNorm += value * value;
	for (const value of right.values()) rightNorm += value * value;
	const smaller = left.size <= right.size ? left : right;
	const larger = left.size <= right.size ? right : left;
	for (const [feature, value] of smaller) dot += value * (larger.get(feature) ?? 0);
	if (leftNorm === 0 || rightNorm === 0) return 0;
	return dot / Math.sqrt(leftNorm * rightNorm);
}
function noisyOr(scores) {
	let remainingMass = 1;
	for (const score of scores) remainingMass *= 1 - clamp01(score);
	return clamp01(1 - remainingMass);
}
function surfaceSimilarityFromNormalized(normalizedLeft, normalizedRight) {
	if (!normalizedLeft || !normalizedRight) return 0;
	if (normalizedLeft === normalizedRight) return 1;
	const leftTokens = extractTokens(normalizedLeft);
	const rightTokens = extractTokens(normalizedRight);
	const unigramScore = cosineFromSparse(toSparseTf(leftTokens), toSparseTf(rightTokens));
	const bigramScore = cosineFromSparse(toSparseTf(buildTokenBigrams(leftTokens)), toSparseTf(buildTokenBigrams(rightTokens)));
	const charTrigramScore = cosineFromSparse(toSparseTf(buildCharNgrams(normalizedLeft, 3)), toSparseTf(buildCharNgrams(normalizedRight, 3)));
	const charFourgramScore = cosineFromSparse(toSparseTf(buildCharNgrams(normalizedLeft, 4)), toSparseTf(buildCharNgrams(normalizedRight, 4)));
	const sequenceScore = noisyOr([
		unigramScore * .5,
		bigramScore * .55,
		charTrigramScore * .62,
		charFourgramScore * .48
	]);
	const containmentScore = Math.min(normalizedLeft.length, normalizedRight.length) >= 24 && (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) ? .97 : 0;
	return clamp01(Math.max(sequenceScore, containmentScore));
}
function surfaceSimilarity(left, right) {
	return surfaceSimilarityFromNormalized(normalizeText(left), normalizeText(right));
}
function classifyLabelFamily(label) {
	const normalized = normalizeText(label).toLowerCase();
	if (!normalized) return;
	if (normalized === "workflow.current_task" || normalized === "active task" || normalized === "task focus") return "task";
	if (normalized === "workflow.next_action" || normalized === "next action") return "next_action";
	if (normalized === "workflow.blocker" || normalized === "active blocker") return "blocker";
	if (normalized === "project.active_project" || normalized === "active project") return "project";
	if (normalized === "open risk") return "risk";
	if (normalized === "reply guidance") return "guidance";
	if (normalized === "working strategies") return "strategy";
	return normalized.replace(/\s+/gu, "_");
}
function extractGraphNodeNames(value) {
	if (!value.includes("-->")) return [];
	return value.split(/\s*--[a-z_]+-->\s*/iu).map((segment) => normalizeText(segment)).map((segment) => segment.trim()).filter(Boolean);
}
function extractGraphRelationNames(value) {
	return [...value.matchAll(GRAPH_REL_RE)].map((match) => normalizeText(match[1] ?? "")).map((segment) => segment.trim()).filter(Boolean);
}
function parseStructuredText(value) {
	const normalized = normalizeText(value);
	const labelMatch = normalized.match(LABEL_VALUE_RE);
	const label = labelMatch?.[1]?.trim();
	return {
		raw: normalized,
		label,
		value: labelMatch?.[2]?.trim(),
		labelFamily: label ? classifyLabelFamily(label) : void 0,
		graphNodeNames: extractGraphNodeNames(normalized),
		graphRelationNames: extractGraphRelationNames(normalized)
	};
}
function overlapScore(left, right) {
	if (left.length === 0 || right.length === 0) return 0;
	const leftSet = new Set(left.map((item) => normalizeText(item).toLowerCase()).filter(Boolean));
	const rightSet = new Set(right.map((item) => normalizeText(item).toLowerCase()).filter(Boolean));
	if (leftSet.size === 0 || rightSet.size === 0) return 0;
	let shared = 0;
	for (const item of leftSet) if (rightSet.has(item)) shared += 1;
	return clamp01(shared / Math.sqrt(leftSet.size * rightSet.size));
}
function structuredSimilarity(left, right) {
	const leftValue = left.value ?? left.raw;
	const rightValue = right.value ?? right.raw;
	const leftLabel = left.label ?? "";
	const rightLabel = right.label ?? "";
	const valueScore = surfaceSimilarity(leftValue, rightValue);
	const crossScore = Math.max(left.value ? surfaceSimilarity(left.value, right.raw) : 0, right.value ? surfaceSimilarity(left.raw, right.value) : 0);
	const labelScore = leftLabel && rightLabel ? surfaceSimilarity(leftLabel, rightLabel) : 0;
	const familyBonus = left.labelFamily && right.labelFamily && left.labelFamily === right.labelFamily && Math.max(valueScore, crossScore, labelScore) >= .14 ? .16 : 0;
	const shortStructuredBoost = Math.min(left.raw.length, right.raw.length) <= 32 && left.value && right.value && Math.max(valueScore, crossScore) >= .22 ? Math.max(valueScore, crossScore) * .08 : 0;
	const graphNodeScore = overlapScore(left.graphNodeNames, right.graphNodeNames.length > 0 ? right.graphNodeNames : extractTokens(rightValue));
	const reverseGraphNodeScore = overlapScore(right.graphNodeNames, left.graphNodeNames.length > 0 ? left.graphNodeNames : extractTokens(leftValue));
	const graphRelationScore = overlapScore(left.graphRelationNames, right.graphRelationNames);
	const graphScore = noisyOr([Math.max(graphNodeScore, reverseGraphNodeScore) * .82, graphRelationScore * .28]);
	return clamp01(Math.max(noisyOr([
		valueScore * .68,
		crossScore * .64,
		labelScore * .22,
		familyBonus,
		shortStructuredBoost
	]), graphScore));
}
function semanticTextSimilarity(left, right) {
	const normalizedLeft = normalizeText(left);
	const normalizedRight = normalizeText(right);
	if (!normalizedLeft || !normalizedRight) return 0;
	if (normalizedLeft === normalizedRight) return 1;
	return clamp01(Math.max(surfaceSimilarityFromNormalized(normalizedLeft, normalizedRight), structuredSimilarity(parseStructuredText(normalizedLeft), parseStructuredText(normalizedRight))));
}
const BASIC_STOPWORDS = new Set([
	"the",
	"a",
	"an",
	"是",
	"的",
	"了",
	"and",
	"to"
]);
function lexicalSimilarity(left, right) {
	const leftTokens = new Set(tokenizeSearchTerms(left, BASIC_STOPWORDS));
	const rightTokens = new Set(tokenizeSearchTerms(right, BASIC_STOPWORDS));
	if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
	let overlap = 0;
	for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
	return overlap / Math.max(Math.min(leftTokens.size, rightTokens.size), 1);
}
function ngramSimilarity(left, right, n = 3) {
	const source = normalizeText(left).replace(/\s+/g, " ").trim();
	const target = normalizeText(right).replace(/\s+/g, " ").trim();
	if (!source || !target) return 0;
	if (source.length < n || target.length < n) return source.includes(target) || target.includes(source) ? 1 : 0;
	const leftNgrams = /* @__PURE__ */ new Set();
	const rightNgrams = /* @__PURE__ */ new Set();
	for (let index = 0; index <= source.length - n; index += 1) leftNgrams.add(source.slice(index, index + n));
	for (let index = 0; index <= target.length - n; index += 1) rightNgrams.add(target.slice(index, index + n));
	if (leftNgrams.size === 0 || rightNgrams.size === 0) return 0;
	let overlap = 0;
	for (const gram of leftNgrams) if (rightNgrams.has(gram)) overlap += 1;
	return overlap / Math.max(Math.min(leftNgrams.size, rightNgrams.size), 1);
}
function basicSemanticSimilarity(left, right) {
	return Math.max(lexicalSimilarity(left, right), ngramSimilarity(left, right, 3));
}
//#endregion
export { basicSemanticSimilarity, semanticTextSimilarity };
