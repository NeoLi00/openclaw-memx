import type { EvidenceBundle, EvidenceRow, MemoryPrimaryRouteType, MemoryRouteType, MemorySelectionObjective, ScheduledMemoryObject, WorkingProjectionBlock } from "../types.js";
export declare function buildWorkingProjectionBlocks(params: {
    behavioralGuidance: string[];
    states: EvidenceRow[];
}): WorkingProjectionBlock[];
export declare function projectScheduledMemoryObjects(scheduled: ScheduledMemoryObject[], options: {
    routeType: MemoryRouteType;
    routeConfidence: number;
    allowHistoricalFacts: boolean;
    preferTemporalEvents: boolean;
    stateLimit: number;
    taskLimit: number;
    factLimit: number;
    eventLimit: number;
    graphLimit: number;
    alternateLimit: number;
    recallChunkBudget: number;
}): Pick<EvidenceBundle, "states" | "tasks" | "facts" | "events" | "graph" | "alternates" | "recalledChunkIds" | "recalledChunkTexts">;
export declare function createMemorySelectionObjective(routeType: MemoryPrimaryRouteType, query: string, now: string, currentSessionKey?: string): MemorySelectionObjective;
