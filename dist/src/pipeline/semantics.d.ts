import type { MemoryCandidateCorrectionHint, MemoryCandidateDecisionHint, MemoryCandidatePreferenceHint, MemoryCandidateRelationHint, MemoryCandidateWorkflowHint, RecallQueryShape } from "../types.js";
import { analyzeCorrectionHint, analyzeRecallQueryShape, canonicalStateKey, expandStateKeyAliases, extractTimeHints, extractQueryAnchors, hasExplicitRememberIntent, inferEntityNames, isDeicticWorkflowReferenceQuery, isBroadTemporalQuery, isLowValueChatter, isQuestionLike, normalizedEntityId, normalizeGraphRelationType, parseAllRelations, parseRelation, predicateHint, queryAnchorSupport, seedEntityNamesFromQuery, semanticRoleHint, tokenizeSearchTerms, wantsProjectProfileSnapshot, wantsCurrentFactualSnapshot, wantsHistoricalFacts } from "./semantic/heuristics.js";
import { judgeQueryRoute, routeExplanatory, routeFactual, routeTemporal, routeWorkflow } from "./semantic/judges.js";
type SemanticHintSummary = {
    entities: Array<{
        name: string;
        type?: string;
    }>;
    timeHints: string[];
    preference: MemoryCandidatePreferenceHint | null;
    workflow: MemoryCandidateWorkflowHint | null;
    workflows: MemoryCandidateWorkflowHint[];
    relation: MemoryCandidateRelationHint | null;
    relations: MemoryCandidateRelationHint[];
    decision: MemoryCandidateDecisionHint | null;
    correction: MemoryCandidateCorrectionHint | null;
};
export { analyzeCorrectionHint, analyzeRecallQueryShape, canonicalStateKey, expandStateKeyAliases, extractTimeHints, extractQueryAnchors, hasExplicitRememberIntent, inferEntityNames, isDeicticWorkflowReferenceQuery, isBroadTemporalQuery, isLowValueChatter, isQuestionLike, normalizedEntityId, normalizeGraphRelationType, parseAllRelations, parseRelation, predicateHint, queryAnchorSupport, routeExplanatory, routeFactual, routeTemporal, routeWorkflow, seedEntityNamesFromQuery, semanticRoleHint, tokenizeSearchTerms, wantsProjectProfileSnapshot, wantsCurrentFactualSnapshot, wantsHistoricalFacts, judgeQueryRoute, };
export declare function inferTemporalSince(query: string, now: string): string | undefined;
export declare function parsePreferenceSignal(text: string): {
    predicate: string;
    object: string;
} | null;
export declare function canonicalizePreferencePredicate(value: string): string | null;
export declare function canonicalizePreferenceHint(hint: MemoryCandidatePreferenceHint | null | undefined): MemoryCandidatePreferenceHint | null;
export declare function parseWorkflowState(text: string): {
    key: string;
    value: Record<string, unknown>;
} | null;
export declare function analyzeSemanticHints(text: string): SemanticHintSummary;
export declare function hasPreferenceHint(text: string): boolean;
export declare function hasTaskStateHint(text: string): boolean;
export declare function hasRelationHint(text: string): boolean;
export declare function hasDecisionHint(text: string): boolean;
export declare function analyzeQueryShape(query: string): RecallQueryShape;
