import type { ConversationTask } from "../../types.js";
import type { MemxDbClient } from "../client.js";
export declare class TaskRepo {
    private readonly db;
    constructor(db: MemxDbClient);
    create(task: ConversationTask): void;
    update(taskId: string, patch: Partial<ConversationTask>): void;
    get(taskId: string): ConversationTask | null;
    getActive(params: {
        agentId: string;
        scope: string;
        sessionKey: string;
    }): ConversationTask | null;
    listActive(params: {
        agentId: string;
        scopes: string[];
        sessionKey?: string;
        limit?: number;
    }): ConversationTask[];
    listRecent(params: {
        agentId: string;
        scopes: string[];
        limit?: number;
        includeSkipped?: boolean;
        sessionKey?: string;
    }): ConversationTask[];
    latestUpdatedAt(params: {
        agentId: string;
        scopes: string[];
        sessionKey?: string;
    }): string | undefined;
    private toTask;
}
