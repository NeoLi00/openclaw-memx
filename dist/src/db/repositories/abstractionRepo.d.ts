import type { AbstractionCandidateRecord } from "../../types.js";
import type { MemxDbClient } from "../client.js";
export declare class AbstractionRepo {
    private readonly db;
    constructor(db: MemxDbClient);
    upsert(record: AbstractionCandidateRecord): void;
    listByAgent(params: {
        agentId: string;
        scopes?: string[];
        abstractionTypes?: AbstractionCandidateRecord["abstractionType"][];
        stages?: AbstractionCandidateRecord["stage"][];
        limit?: number;
        readEpoch?: number;
    }): AbstractionCandidateRecord[];
    getById(candidateId: string): AbstractionCandidateRecord | undefined;
    countByAgent(params: {
        agentId: string;
        stages?: AbstractionCandidateRecord["stage"][];
    }): number;
    private toCandidate;
}
