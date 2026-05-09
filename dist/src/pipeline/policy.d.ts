import type { MemoryCandidate, MemoryOperationContext, MemoryPolicyDecision } from "../types.js";
import type { MemxReasoner } from "./reasoner.js";
export type PolicyEvaluationResult = {
    candidate: MemoryCandidate;
    decision: MemoryPolicyDecision;
};
type PolicyReasoner = Pick<MemxReasoner, "judgeCandidatePolicy">;
export declare function evaluatePolicyHeuristically(candidate: MemoryCandidate, ctx: MemoryOperationContext): PolicyEvaluationResult;
export declare function evaluatePolicy(candidate: MemoryCandidate, ctx: MemoryOperationContext, options?: {
    reasoner?: PolicyReasoner;
}): Promise<PolicyEvaluationResult>;
export {};
