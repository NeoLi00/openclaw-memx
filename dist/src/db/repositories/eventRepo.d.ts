import type { NormalizedEvent } from "../../types.js";
import type { MemxDbClient } from "../client.js";
export declare class EventRepo {
    private readonly db;
    constructor(db: MemxDbClient);
    get(eventId: string): NormalizedEvent | null;
    findNearDuplicate(params: {
        agentId: string;
        scope: string;
        normalizedText: string;
        observedAfter: string;
    }): NormalizedEvent | null;
    append(event: NormalizedEvent): void;
    search(params: {
        agentId: string;
        scopes: string[];
        sessionKey?: string;
        text?: string;
        eventType?: string;
        limit?: number;
        since?: string;
        after?: string;
        until?: string;
        readEpoch?: number;
    }): NormalizedEvent[];
    delete(params: {
        agentId: string;
        eventId?: string;
        scope?: string;
    }): number;
    latestObservedAt(params: {
        agentId: string;
        scopes: string[];
        sessionKey?: string;
    }): string | undefined;
    private toEvent;
}
