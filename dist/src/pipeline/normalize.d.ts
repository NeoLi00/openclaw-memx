import type { ClassifiedCandidate, MemoryOperationContext, NormalizedEntity, NormalizedEvent, NormalizedFact, NormalizedGraphEdge, NormalizedState, VectorDocRecord } from "../types.js";
type NormalizedOutputs = {
    states: NormalizedState[];
    facts: NormalizedFact[];
    events: NormalizedEvent[];
    entities: NormalizedEntity[];
    edges: NormalizedGraphEdge[];
    vectorDocs: VectorDocRecord[];
};
export declare function buildStoredFactObjectValueJson(params: {
    subject: string;
    predicate: string;
    object?: string;
    objectValueJson?: Record<string, unknown>;
}): Record<string, unknown> | undefined;
export declare function normalizeCandidate(candidate: ClassifiedCandidate, ctx: MemoryOperationContext): NormalizedOutputs;
export declare function computeConfidence(candidate: ClassifiedCandidate): number;
export {};
