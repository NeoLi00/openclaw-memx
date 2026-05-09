import type { MemoryWorkflowStateKind, MemxStateLifecycleKind, NormalizedState, StateCurrentness } from "../types";
type StateLikeInput = {
    key: string;
    stateKind?: MemoryWorkflowStateKind;
    valueJson?: Record<string, unknown>;
    sourceRef?: string;
    supportRefs?: string[];
    updatedAt?: string;
    observedAt?: string;
    validFrom?: string;
    expiresAt?: string;
    scope?: string;
    sessionKey?: string;
    taskId?: string;
};
type StateVectorMetadata = Record<string, unknown>;
export declare function classifyStateLifecycle(input: StateLikeInput): MemxStateLifecycleKind;
export declare function evaluateStateCurrentness(input: StateLikeInput & {
    now: string;
}): StateCurrentness;
export declare function stateCurrentnessVectorMetadata(state: NormalizedState, now?: any): Record<string, unknown>;
export declare function stateCurrentnessFromVectorMetadata(metadata: StateVectorMetadata | undefined, now: string): StateCurrentness | undefined;
export declare function stateCurrentnessToMetadata(currentness: StateCurrentness): Record<string, unknown>;
export declare function stateSupportRefs(input: StateLikeInput): string[];
export {};
