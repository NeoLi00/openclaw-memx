import { normalizeText } from "../support.js";
import type { QueryAnswerMode, QueryCompileResult } from "../types.js";

export type EvidenceCoverageScore = {
  requiredHits: string[];
  missingRequired: string[];
  coverageScore: number;
  answerMode: QueryAnswerMode;
};

function queryAnswerMode(queryAnalysis: QueryCompileResult): QueryAnswerMode {
  return queryAnalysis.answerMode ?? "single_fact";
}

function uniqueAnchors(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = normalizeText(trimmed);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function anchorMatches(text: string, anchor: string): boolean {
  const normalizedText = normalizeText(text);
  const normalizedAnchor = normalizeText(anchor);
  if (!normalizedText || !normalizedAnchor) {
    return false;
  }
  const anchorTokens = normalizedAnchor
    .split(/[^\p{L}\p{N}']+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  if (anchorTokens.length === 0) {
    return false;
  }
  const textTokenSet = new Set(
    normalizedText
      .split(/[^\p{L}\p{N}']+/u)
      .map((token) => normalizeText(token))
      .filter(Boolean),
  );
  return anchorTokens.every((token) => textTokenSet.has(normalizeText(token)));
}

export function evidenceCoverageForText(
  queryAnalysis: QueryCompileResult,
  text: string,
): EvidenceCoverageScore {
  const requiredAnchors = uniqueAnchors(queryAnalysis.evidenceCoverage?.requiredAnchors ?? []);
  if (requiredAnchors.length === 0) {
    return {
      requiredHits: [],
      missingRequired: [],
      coverageScore: 1,
      answerMode: queryAnswerMode(queryAnalysis),
    };
  }
  const requiredHits = requiredAnchors.filter((anchor) => anchorMatches(text, anchor));
  const missingRequired = requiredAnchors.filter((anchor) => !requiredHits.includes(anchor));
  return {
    requiredHits,
    missingRequired,
    coverageScore: requiredHits.length / requiredAnchors.length,
    answerMode: queryAnswerMode(queryAnalysis),
  };
}

export function capScoreByEvidenceCoverage(score: number, coverage: EvidenceCoverageScore): number {
  if (coverage.missingRequired.length === 0) {
    return score;
  }
  if (score >= 0.62) {
    return Math.min(score, coverage.requiredHits.length > 0 ? 0.72 : 0.66);
  }
  if (score >= 0.52) {
    return Math.min(score, coverage.requiredHits.length > 0 ? 0.58 : 0.46);
  }
  if (coverage.requiredHits.length === 0) {
    return Math.min(score, 0.24);
  }
  if (coverage.answerMode === "count_aggregate" || coverage.answerMode === "multi_evidence") {
    return Math.min(score, 0.52);
  }
  return Math.min(score, 0.34);
}
