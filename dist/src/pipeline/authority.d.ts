import type { MemoryCandidatePreferenceHint, MemoryCandidateRelationHint, MemoryCandidateWorkflowHint, NormalizedState } from "../types.js";
export declare const TASK_METADATA_WORKFLOW_SNAPSHOT_DESCRIPTORS: readonly [{
    readonly metadataKey: "currentTask";
    readonly stateKey: "workflow.current_task";
    readonly baseScore: 0.9;
    readonly confidence: 0.86;
}, {
    readonly metadataKey: "nextAction";
    readonly stateKey: "workflow.next_action";
    readonly baseScore: 0.88;
    readonly confidence: 0.84;
}];
export declare const SNAPSHOT_ALLOWED_STATE_KEYS: Set<string>;
export declare const SNAPSHOT_SUPPRESSED_WORKFLOW_STATE_KEYS: Set<string>;
export declare const BACKGROUND_ANCHORED_WORKFLOW_STATE_KEYS: Set<string>;
export declare const CANONICAL_WORKFLOW_STATE_KEYS: Set<string>;
export type CanonicalOwnerKind = "state" | "fact" | "event" | "graph" | "task_metadata" | "projection";
type TaskMetadataKey = "project" | "currentTask" | "nextAction" | "blocker";
export declare function sanitizeTaskMetadataValue(key: TaskMetadataKey, value: unknown, params?: {
    currentProject?: string;
    knownProjects?: string[];
}): string | undefined;
export declare function sanitizeTaskMetadata(metadata: Record<string, unknown> | undefined, params?: {
    currentProject?: string;
    knownProjects?: string[];
}): Partial<Record<TaskMetadataKey, string>>;
export declare function hasProjectIdentityConflict(values: string[]): boolean;
export declare function isSnapshotFactualStateKey(key: string): boolean;
export declare function isCanonicalWorkflowStateKey(key: string): boolean;
export declare function canonicalOwnerForWorkflowStateKey(key: string): CanonicalOwnerKind | null;
export declare function canonicalOwnerForPreferenceHint(_preference: Pick<MemoryCandidatePreferenceHint, "predicate">): CanonicalOwnerKind;
export declare function canonicalOwnerForRelationHint(relation: Pick<MemoryCandidateRelationHint, "predicate" | "relationSlot">): CanonicalOwnerKind;
export declare function sanitizeWorkflowHint(workflow: MemoryCandidateWorkflowHint): MemoryCandidateWorkflowHint | null;
export declare function shouldDeriveProjectProfileArtifacts(state: Pick<NormalizedState, "key" | "stateKind">): boolean;
export declare function shouldDeriveRelationFact(relation: Pick<MemoryCandidateRelationHint, "predicate" | "relationSlot">): boolean;
export declare function shouldMaterializePreferenceFact(preference: Pick<MemoryCandidatePreferenceHint, "predicate" | "object">): boolean;
export declare function shouldProjectActiveProjectAlias(): boolean;
export {};
