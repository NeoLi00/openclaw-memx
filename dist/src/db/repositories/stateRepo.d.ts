import type { NormalizedState } from "../../types.js";
import type { MemxDbClient } from "../client.js";
export declare class StateRepo {
    private readonly db;
    constructor(db: MemxDbClient);
    upsert(state: NormalizedState): void;
    get(params: {
        agentId: string;
        scopes: string[];
        key?: string;
        includeExpired?: boolean;
        now?: string;
        readEpoch?: number;
    }): NormalizedState[];
    delete(params: {
        agentId: string;
        scope?: string;
        key?: string;
    }): number;
    expireSessionStates(agentId: string, now: string): number;
    createExpiry(updatedAt: string, ttlHours: number): string;
}
