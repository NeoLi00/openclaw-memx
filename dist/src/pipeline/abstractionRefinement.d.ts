import type { AbstractionCandidateRecord } from "../types.js";
import type { AbstractionCandidateJudgeResult } from "./reasoner.js";
type ResolvedJudgeModel = {
    provider: string | null;
    model: string | null;
};
export declare function eligibleForLlmRefinement(candidate: AbstractionCandidateRecord): boolean;
export declare function applyAbstractionRefinement(params: {
    candidate: AbstractionCandidateRecord;
    result: AbstractionCandidateJudgeResult;
    now: string;
    resolvedModel: ResolvedJudgeModel | null;
}): AbstractionCandidateRecord | null;
export {};
