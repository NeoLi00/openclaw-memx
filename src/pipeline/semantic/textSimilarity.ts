import { clamp01, normalizeText, normalizedTerms } from "../../support.js";
import { tokenizeSearchTerms } from "./heuristics.js";

const LABEL_VALUE_RE = /^\s*([^:\n]{2,48}):\s+(.+)$/u;
const GRAPH_REL_RE = /--([a-z_]+)-->/giu;

type StructuredText = {
  raw: string;
  label?: string;
  value?: string;
  labelFamily?: string;
  graphNodeNames: string[];
  graphRelationNames: string[];
};

function extractTokens(value: string): string[] {
  return normalizedTerms(value, { minLength: 2 });
}

function compactText(value: string): string {
  return normalizeText(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function toSparseTf(features: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const feature of features) {
    counts.set(feature, (counts.get(feature) ?? 0) + 1);
  }
  for (const [feature, count] of counts) {
    counts.set(feature, 1 + Math.log1p(count));
  }
  return counts;
}

function buildTokenBigrams(tokens: string[]): string[] {
  if (tokens.length < 2) {
    return [];
  }
  const bigrams: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    bigrams.push(`${tokens[index]}\u0001${tokens[index + 1]}`);
  }
  return bigrams;
}

function buildCharNgrams(value: string, n: number): string[] {
  const compact = compactText(value);
  if (!compact) {
    return [];
  }
  if (compact.length <= n) {
    return [compact];
  }
  const grams: string[] = [];
  for (let index = 0; index <= compact.length - n; index += 1) {
    grams.push(compact.slice(index, index + n));
  }
  return grams;
}

function cosineFromSparse(left: Map<string, number>, right: Map<string, number>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of left.values()) {
    leftNorm += value * value;
  }
  for (const value of right.values()) {
    rightNorm += value * value;
  }
  const smaller = left.size <= right.size ? left : right;
  const larger = left.size <= right.size ? right : left;
  for (const [feature, value] of smaller) {
    dot += value * (larger.get(feature) ?? 0);
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function noisyOr(scores: number[]): number {
  let remainingMass = 1;
  for (const score of scores) {
    remainingMass *= 1 - clamp01(score);
  }
  return clamp01(1 - remainingMass);
}

function surfaceSimilarityFromNormalized(normalizedLeft: string, normalizedRight: string): number {
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const leftTokens = extractTokens(normalizedLeft);
  const rightTokens = extractTokens(normalizedRight);
  const unigramScore = cosineFromSparse(toSparseTf(leftTokens), toSparseTf(rightTokens));
  const bigramScore = cosineFromSparse(
    toSparseTf(buildTokenBigrams(leftTokens)),
    toSparseTf(buildTokenBigrams(rightTokens)),
  );
  const charTrigramScore = cosineFromSparse(
    toSparseTf(buildCharNgrams(normalizedLeft, 3)),
    toSparseTf(buildCharNgrams(normalizedRight, 3)),
  );
  const charFourgramScore = cosineFromSparse(
    toSparseTf(buildCharNgrams(normalizedLeft, 4)),
    toSparseTf(buildCharNgrams(normalizedRight, 4)),
  );

  const sequenceScore = noisyOr([
    unigramScore * 0.5,
    bigramScore * 0.55,
    charTrigramScore * 0.62,
    charFourgramScore * 0.48,
  ]);

  const shorterLength = Math.min(normalizedLeft.length, normalizedRight.length);
  const containmentScore =
    shorterLength >= 24 &&
    (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
      ? 0.97
      : 0;

  return clamp01(Math.max(sequenceScore, containmentScore));
}

function surfaceSimilarity(left: string, right: string): number {
  return surfaceSimilarityFromNormalized(normalizeText(left), normalizeText(right));
}

function classifyLabelFamily(label: string): string | undefined {
  const normalized = normalizeText(label).toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized === "workflow.current_task" ||
    normalized === "active task" ||
    normalized === "task focus"
  ) {
    return "task";
  }
  if (normalized === "workflow.next_action" || normalized === "next action") {
    return "next_action";
  }
  if (normalized === "workflow.blocker" || normalized === "active blocker") {
    return "blocker";
  }
  if (normalized === "project.active_project" || normalized === "active project") {
    return "project";
  }
  if (normalized === "open risk") {
    return "risk";
  }
  if (normalized === "reply guidance") {
    return "guidance";
  }
  if (normalized === "working strategies") {
    return "strategy";
  }
  return normalized.replace(/\s+/gu, "_");
}

function extractGraphNodeNames(value: string): string[] {
  if (!value.includes("-->")) {
    return [];
  }
  return value
    .split(/\s*--[a-z_]+-->\s*/iu)
    .map((segment) => normalizeText(segment))
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function extractGraphRelationNames(value: string): string[] {
  return [...value.matchAll(GRAPH_REL_RE)]
    .map((match) => normalizeText(match[1] ?? ""))
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function parseStructuredText(value: string): StructuredText {
  const normalized = normalizeText(value);
  const labelMatch = normalized.match(LABEL_VALUE_RE);
  const label = labelMatch?.[1]?.trim();
  const body = labelMatch?.[2]?.trim();
  return {
    raw: normalized,
    label,
    value: body,
    labelFamily: label ? classifyLabelFamily(label) : undefined,
    graphNodeNames: extractGraphNodeNames(normalized),
    graphRelationNames: extractGraphRelationNames(normalized),
  };
}

function overlapScore(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const leftSet = new Set(left.map((item) => normalizeText(item).toLowerCase()).filter(Boolean));
  const rightSet = new Set(right.map((item) => normalizeText(item).toLowerCase()).filter(Boolean));
  if (leftSet.size === 0 || rightSet.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const item of leftSet) {
    if (rightSet.has(item)) {
      shared += 1;
    }
  }
  return clamp01(shared / Math.sqrt(leftSet.size * rightSet.size));
}

function structuredSimilarity(left: StructuredText, right: StructuredText): number {
  const leftValue = left.value ?? left.raw;
  const rightValue = right.value ?? right.raw;
  const leftLabel = left.label ?? "";
  const rightLabel = right.label ?? "";
  const valueScore = surfaceSimilarity(leftValue, rightValue);
  const crossScore = Math.max(
    left.value ? surfaceSimilarity(left.value, right.raw) : 0,
    right.value ? surfaceSimilarity(left.raw, right.value) : 0,
  );
  const labelScore = leftLabel && rightLabel ? surfaceSimilarity(leftLabel, rightLabel) : 0;
  const familyBonus =
    left.labelFamily &&
    right.labelFamily &&
    left.labelFamily === right.labelFamily &&
    Math.max(valueScore, crossScore, labelScore) >= 0.14
      ? 0.16
      : 0;
  const shortStructuredBoost =
    Math.min(left.raw.length, right.raw.length) <= 32 &&
    left.value &&
    right.value &&
    Math.max(valueScore, crossScore) >= 0.22
      ? Math.max(valueScore, crossScore) * 0.08
      : 0;
  const graphNodeScore = overlapScore(
    left.graphNodeNames,
    right.graphNodeNames.length > 0 ? right.graphNodeNames : extractTokens(rightValue),
  );
  const reverseGraphNodeScore = overlapScore(
    right.graphNodeNames,
    left.graphNodeNames.length > 0 ? left.graphNodeNames : extractTokens(leftValue),
  );
  const graphRelationScore = overlapScore(left.graphRelationNames, right.graphRelationNames);
  const graphScore = noisyOr([
    Math.max(graphNodeScore, reverseGraphNodeScore) * 0.82,
    graphRelationScore * 0.28,
  ]);

  return clamp01(
    Math.max(
      noisyOr([
        valueScore * 0.68,
        crossScore * 0.64,
        labelScore * 0.22,
        familyBonus,
        shortStructuredBoost,
      ]),
      graphScore,
    ),
  );
}

export function semanticTextSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  return clamp01(
    Math.max(
      surfaceSimilarityFromNormalized(normalizedLeft, normalizedRight),
      structuredSimilarity(
        parseStructuredText(normalizedLeft),
        parseStructuredText(normalizedRight),
      ),
    ),
  );
}

const BASIC_STOPWORDS = new Set(["the", "a", "an", "是", "的", "了", "and", "to"]);

export function lexicalSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenizeSearchTerms(left, BASIC_STOPWORDS));
  const rightTokens = new Set(tokenizeSearchTerms(right, BASIC_STOPWORDS));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(Math.min(leftTokens.size, rightTokens.size), 1);
}

export function ngramSimilarity(left: string, right: string, n = 3): number {
  const source = normalizeText(left).replace(/\s+/g, " ").trim();
  const target = normalizeText(right).replace(/\s+/g, " ").trim();
  if (!source || !target) {
    return 0;
  }
  if (source.length < n || target.length < n) {
    return source.includes(target) || target.includes(source) ? 1 : 0;
  }
  const leftNgrams = new Set<string>();
  const rightNgrams = new Set<string>();
  for (let index = 0; index <= source.length - n; index += 1) {
    leftNgrams.add(source.slice(index, index + n));
  }
  for (let index = 0; index <= target.length - n; index += 1) {
    rightNgrams.add(target.slice(index, index + n));
  }
  if (leftNgrams.size === 0 || rightNgrams.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const gram of leftNgrams) {
    if (rightNgrams.has(gram)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(Math.min(leftNgrams.size, rightNgrams.size), 1);
}

export function basicSemanticSimilarity(left: string, right: string): number {
  return Math.max(lexicalSimilarity(left, right), ngramSimilarity(left, right, 3));
}
