import type { ClassifiedCandidate, MemoryCandidate, MemoryOperationContext } from "../types.js";
import type { MemxReasoner } from "./reasoner.js";
export declare function reflectCandidates(candidates: MemoryCandidate[], ctx: MemoryOperationContext, options?: {
    reasoner?: MemxReasoner;
}): Promise<ClassifiedCandidate[]>;
