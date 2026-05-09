import type { SourceSegmentRecord } from "../../types.js";
import type { MemxDbClient } from "../client.js";
export declare class SourceSegmentRepo {
    private readonly db;
    constructor(db: MemxDbClient);
    insertMany(segments: SourceSegmentRecord[]): void;
    listByChunk(chunkId: string): SourceSegmentRecord[];
    listBySourceGroup(params: {
        agentId: string;
        scopes: string[];
        sourceGroupId: string;
    }): SourceSegmentRecord[];
    listByParentSourceRefs(params: {
        agentId: string;
        scopes: string[];
        parentSourceRefs: string[];
        limit?: number;
    }): SourceSegmentRecord[];
    private toRecord;
}
