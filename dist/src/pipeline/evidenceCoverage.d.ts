import type { QueryAnswerMode, QueryCompileResult } from "../types.js";
export type EvidenceCoverageScore = {
    requiredHits: string[];
    missingRequired: string[];
    coverageScore: number;
    answerMode: QueryAnswerMode;
};
export declare function evidenceCoverageForText(queryAnalysis: QueryCompileResult, text: string): EvidenceCoverageScore;
export declare function capScoreByEvidenceCoverage(score: number, coverage: EvidenceCoverageScore): number;
