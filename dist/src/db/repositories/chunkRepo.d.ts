import type { ConversationChunk, ConversationChunkStatus } from "../../types.js";
import type { MemxDbClient } from "../client.js";
export declare class ChunkRepo {
    private readonly db;
    constructor(db: MemxDbClient);
    insert(chunk: ConversationChunk): void;
    get(chunkId: string): ConversationChunk | null;
    findActiveByHash(params: {
        agentId: string;
        scope: string;
        role: ConversationChunk["role"];
        contentHash: string;
    }): ConversationChunk | null;
    listRecentActive(params: {
        agentId: string;
        scopes: string[];
        limit?: number;
        sessionKey?: string;
    }): ConversationChunk[];
    listByTask(taskId: string): ConversationChunk[];
    listBySourceRefs(params: {
        agentId: string;
        scopes: string[];
        sourceRefs: string[];
        limit?: number;
    }): ConversationChunk[];
    listUnassigned(params: {
        agentId: string;
        scope: string;
        sessionKey: string;
    }): ConversationChunk[];
    setTaskId(chunkId: string, taskId: string): void;
    markStatus(params: {
        chunkId: string;
        status: ConversationChunkStatus;
        target?: string;
        reason?: string;
        mergeCount?: number;
        updatedAt: string;
    }): void;
    private toChunk;
}
