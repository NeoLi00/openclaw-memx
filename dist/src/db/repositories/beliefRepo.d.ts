import type { MemoryBeliefRecord } from "../../types.js";
import type { MemxDbClient } from "../client.js";
export declare class BeliefRepo {
    private readonly db;
    constructor(db: MemxDbClient);
    upsert(record: MemoryBeliefRecord): void;
    listByAgent(params: {
        agentId: string;
        limit?: number;
        readEpoch?: number;
    }): MemoryBeliefRecord[];
    /**
     * Mark all active/probationary beliefs whose contentRef matches a superseded fact as superseded.
     * Returns the number of beliefs updated.
     */
    markSupersededByContentRef(params: {
        agentId: string;
        contentRef: string;
        updatedAt: string;
    }): number;
    getById(beliefId: string): MemoryBeliefRecord | undefined;
    private toBelief;
}
