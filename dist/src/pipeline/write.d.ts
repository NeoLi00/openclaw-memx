import type { MemxStoreBundle } from "../runtime.js";
import type { ClassifiedCandidate, MemoryOperationContext } from "../types.js";
export type WriteSummary = {
    states: number;
    facts: number;
    events: number;
    entities: number;
    edges: number;
    vectorDocs: number;
};
export declare function writeCandidate(store: MemxStoreBundle, ctx: MemoryOperationContext, candidate: ClassifiedCandidate): WriteSummary;
