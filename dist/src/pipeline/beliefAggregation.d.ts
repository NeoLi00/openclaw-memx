import type { MemxStoreBundle } from "../runtime.js";
import type { MemoryBeliefKind, MemoryOperationContext, MemorySignalEventRecord } from "../types.js";
type BeliefAggregationTarget = {
    memoryKind: MemoryBeliefKind;
    contentRef?: string;
    semanticKey: string;
};
type BeliefTargetResolution = BeliefAggregationTarget & {
    canonicalEntityId?: string;
    resolutionMethod: string;
    fallbackReason?: string;
    originalContentRef?: string;
    originalSemanticKey: string;
};
export declare function resolveBeliefTargetKey(store: MemxStoreBundle, ctx: MemoryOperationContext, scope: string, signal: MemorySignalEventRecord): BeliefTargetResolution;
export declare function aggregateBeliefs(store: MemxStoreBundle, ctx: MemoryOperationContext, options?: {
    signalWindow?: {
        sessionKey?: string;
        after?: string;
        until?: string;
    };
    scopes?: string[];
}): {
    beliefsUpserted: number;
    signalsProcessed: number;
    beliefsNeedingReevaluation: number;
    beliefsPromoted: number;
    beliefsDemoted: number;
    beliefsQuarantined: number;
    beliefsSuperseded: number;
    beliefsDecaying: number;
};
export {};
