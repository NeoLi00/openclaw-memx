import type { MemxStoreBundle } from "../runtime.js";
import type { BackgroundRecallBundle, ConversationChunk, ConversationTask, EvidenceBundle, GraphEvidenceEdge, MemoryObject, MemoryOperationContext, MemoryPrimaryRouteType, MemoryRouteType, MemorySignalTargetKind, NormalizedEvent, NormalizedFact, NormalizedGraphEdge, NormalizedState, ScheduledMemoryObject, SynthesizedTaskEvent } from "../types.js";
type SignalTarget = {
    memoryKind: MemorySignalTargetKind;
    contentRef?: string;
    semanticKey: string;
};
export declare function emitWriteMaterializationSignals(store: MemxStoreBundle, ctx: Pick<MemoryOperationContext, "agentId" | "sessionKey" | "now" | "scopes">, params: {
    states?: NormalizedState[];
    facts?: NormalizedFact[];
    events?: NormalizedEvent[];
    graphEdges?: NormalizedGraphEdge[];
    materializedEpoch?: number;
}): void;
export declare function signalTargetForMemoryObject(object: MemoryObject): SignalTarget | null;
export declare function emitBackgroundRetrievalSignals(store: MemxStoreBundle, ctx: Pick<MemoryOperationContext, "agentId" | "sessionKey" | "now" | "scopes">, params: {
    auditId: string;
    routeType: MemoryRouteType;
    bundle: BackgroundRecallBundle;
}): void;
export declare function emitFullRetrievalSignals(store: MemxStoreBundle, ctx: Pick<MemoryOperationContext, "agentId" | "sessionKey" | "now" | "scopes">, params: {
    auditId: string;
    bundle: EvidenceBundle;
    scheduled: ScheduledMemoryObject[];
}): void;
export declare function emitContradictionSignals(store: MemxStoreBundle, ctx: Pick<MemoryOperationContext, "agentId" | "sessionKey" | "now" | "scopes">, params: {
    query: string;
    routeType: MemoryPrimaryRouteType;
    graphEdges: GraphEvidenceEdge[];
}): void;
export declare function emitOutcomeFeedbackSignal(store: MemxStoreBundle, ctx: Pick<MemoryOperationContext, "agentId" | "sessionKey" | "now" | "scopes">, params: {
    task: ConversationTask;
    outcome: SynthesizedTaskEvent;
    emitted: boolean;
}): void;
export declare function emitAssistantOutcomeLearningSignals(store: MemxStoreBundle, ctx: Pick<MemoryOperationContext, "agentId" | "sessionKey" | "now" | "scopes">, params: {
    task: ConversationTask;
    outcome: SynthesizedTaskEvent;
    evidenceChunks: ConversationChunk[];
    shouldPromote: boolean;
    emitted: boolean;
    reason: string;
}): void;
export declare function emitBeliefMaintenanceSignals(store: MemxStoreBundle, ctx: Pick<MemoryOperationContext, "agentId" | "sessionKey" | "now" | "scopes">): void;
export {};
