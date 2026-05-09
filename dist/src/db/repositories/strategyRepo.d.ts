import type { StrategyHypothesisRecord } from "../../types.js";
import type { MemxDbClient } from "../client.js";
export declare class StrategyRepo {
    private readonly db;
    constructor(db: MemxDbClient);
    upsert(record: StrategyHypothesisRecord): void;
    listByAgent(params: {
        agentId: string;
        scopes?: string[];
        stages?: StrategyHypothesisRecord["stage"][];
        limit?: number;
        readEpoch?: number;
    }): StrategyHypothesisRecord[];
    private toStrategy;
}
