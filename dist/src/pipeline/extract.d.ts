import type { MemoryCandidate, MemoryPluginConfig } from "../types.js";
export declare function hasExplicitRememberIntent(text: string): boolean;
export declare function buildCandidate(params: {
    sourceKind: MemoryCandidate["source"]["kind"];
    rawText: string;
    observedAt: string;
    config: MemoryPluginConfig;
    source: Partial<MemoryCandidate["source"]>;
    eventType?: string;
    metadata?: Record<string, unknown>;
}): MemoryCandidate | null;
export declare function extractFromMessageReceived(params: {
    content: string;
    observedAt: string;
    config: MemoryPluginConfig;
    metadata?: Record<string, unknown>;
}): MemoryCandidate[];
export declare function extractFromToolResult(params: {
    toolName?: string;
    toolCallId?: string;
    observedAt: string;
    config: MemoryPluginConfig;
    resultMessage: unknown;
}): MemoryCandidate[];
export declare function extractFromAgentEnd(params: {
    messages: unknown[];
    observedAt: string;
    config: MemoryPluginConfig;
    sessionKey?: string;
    runId?: string;
}): MemoryCandidate[];
