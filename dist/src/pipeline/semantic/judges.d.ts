import type { MemoryCandidateRelationHint, RouteDecision } from "../../types.js";
export type PreferenceJudgment = {
    predicate: string;
    object: string;
    confidence: number;
    reason: string;
};
export type WorkflowJudgment = {
    key: string;
    value: Record<string, unknown>;
    confidence: number;
    reason: string;
};
export declare function judgePreferenceSignal(text: string): PreferenceJudgment | null;
export declare function judgeWorkflowState(text: string): WorkflowJudgment | null;
export declare function judgeRelationHint(text: string): MemoryCandidateRelationHint | null;
export declare function judgeAllRelationHints(text: string): MemoryCandidateRelationHint[];
export declare function judgeQueryRoute(query: string): RouteDecision;
export declare function routeWorkflow(query: string): boolean;
export declare function routeFactual(query: string): boolean;
export declare function routeExplanatory(query: string): boolean;
export declare function routeTemporal(query: string): boolean;
