import type { EntityType, GraphRelationType, MemoryCandidateCorrectionHint, RecallQueryShape } from "../../types.js";
declare const STATE_KEY_ALIASES: {
    readonly "project.active_project": readonly ["project.active_project", "active_project"];
    readonly "workflow.current_task": readonly ["workflow.current_task", "current_task"];
    readonly "workflow.current_consideration": readonly ["workflow.current_consideration", "current_consideration", "workflow_candidate_decision"];
    readonly "workflow.next_action": readonly ["workflow.next_action", "workflow_next_step"];
    readonly "workflow.blocker": readonly ["workflow.blocker", "workflow_blocker"];
};
export declare function prototypeSimilarity(text: string, prototypes: string[], stopwords?: Set<string>): number;
export declare function tokenizeSearchTerms(text: string, stopwords: Set<string>): string[];
export declare function hasExplicitRememberIntent(text: string): boolean;
export declare function looksLikeBareMemoryUseInstruction(text: string): boolean;
export declare function looksLikeBareInstructionalGuidance(text: string): boolean;
export declare function isLowValueChatter(text: string): boolean;
export declare function isQuestionLike(text: string): boolean;
export declare function extractTimeHints(text: string): string[];
export declare function stripLead(text: string): string;
export declare function trimCapturedValue(value: string): string;
export declare function cleanProjectName(value: string): string;
export declare function looksLikeProjectDescriptor(value: string): boolean;
/**
 * Infer entity type from name and optional predicate context.
 * Uses a known-name lookup table, suffix heuristics, and predicate hints.
 */
export declare function inferEntityType(name: string, predicateHint?: string): EntityType;
export declare function normalizeGraphRelationType(value: string): {
    relationType: GraphRelationType;
    rawPredicate?: string;
} | null;
type ParsedRelation = {
    subject: string;
    predicate: GraphRelationType;
    object: string;
    rawPredicate?: string;
};
export declare function parseRelation(text: string): ParsedRelation | null;
/**
 * Extract ALL relations from text (not just the first match).
 * Returns an array of parsed relations. Used by Fix-9 multi-relation extraction.
 */
export declare function parseAllRelations(text: string): ParsedRelation[];
export declare function inferEntityNames(text: string): Array<{
    name: string;
    type?: EntityType;
}>;
export declare function extractQueryAnchors(query: string): string[];
export declare function queryAnchorSupport(text: string, anchors: string[]): number;
export declare function seedEntityNamesFromQuery(query: string): string[];
export declare function expandStateKeyAliases(key: string): string[];
export declare function canonicalStateKey(key: string): keyof typeof STATE_KEY_ALIASES;
export declare function wantsHistoricalFacts(query: string): boolean;
export declare function wantsCurrentFactualSnapshot(query: string): boolean;
export declare function analyzeCorrectionHint(params: {
    text: string;
    canonicalKey?: string;
    predicate?: string;
}): MemoryCandidateCorrectionHint | null;
export declare function analyzeRecallQueryShape(query: string): RecallQueryShape;
export declare function wantsProjectProfileSnapshot(query: string): boolean;
export declare function isDeicticWorkflowReferenceQuery(query: string): boolean;
export declare function isBroadTemporalQuery(query: string): boolean;
export declare function predicateHint(query: string): string | undefined;
export declare function semanticRoleHint(text: string): "user_profile" | "workflow" | "relation" | "temporal" | "unknown";
export declare function normalizedEntityId(name: string, type?: string): string;
export {};
