import type { ConversationChunk, ConversationTask, NormalizedEvent, TurnSemanticTaskProposal } from "../types.js";
export type TaskSummarySource = "compiler" | "heuristic_fallback" | "maintenance_llm";
export type TaskSummaryQuality = "working" | "stable";
export type TaskSummaryEvidenceEvent = {
    eventId: string;
    eventType: string;
    summary: string;
    observedAt: string;
    sourceRef: string;
};
export type TaskSummaryEvidenceSet = {
    taskId: string;
    chunks: ConversationChunk[];
    compilerTaskSummary?: {
        summary: string;
        confidence?: number;
    };
    candidateResolution?: string;
    candidateResolutionPhase?: string;
    candidateResolutionEvidenceChunkIds: string[];
    project?: string;
    currentTask?: string;
    nextAction?: string;
    blocker?: string;
    lastEmittedOutcomeKey?: string;
    linkedEvents: TaskSummaryEvidenceEvent[];
    supportRefs: string[];
    fingerprint: string;
};
export type WorkingTaskSummaryResolution = {
    title: string;
    summary: string;
    metadataJson: Record<string, unknown>;
    summarySource: TaskSummarySource;
    summaryQuality: TaskSummaryQuality;
    summaryBasisFingerprint: string;
    compilerTaskSummary?: string;
    compilerTaskSummaryConfidence?: number;
};
export declare function taskSummarySource(metadataJson: Record<string, unknown> | undefined): TaskSummarySource | undefined;
export declare function taskSummaryQuality(metadataJson: Record<string, unknown> | undefined): TaskSummaryQuality | undefined;
export declare function taskSummarySupportsSemanticConsumers(metadataJson: Record<string, unknown> | undefined): boolean;
export declare function semanticTaskSummaryText(task: {
    summary: string;
    metadataJson?: Record<string, unknown>;
}): string | undefined;
export declare function taskSummaryMetadataFields(params: {
    summarySource: TaskSummarySource;
    summaryQuality: TaskSummaryQuality;
    summaryBasisFingerprint: string;
    observedAt: string;
    compilerTaskSummary?: string;
    compilerTaskSummaryConfidence?: number;
}): Record<string, unknown>;
export declare function summarizeTaskHeuristically(chunks: ConversationChunk[]): {
    title: string;
    summary: string;
    metadataJson: Record<string, unknown>;
};
export declare function computeTaskSummaryBasisFingerprint(params: {
    taskId: string;
    chunkIds: string[];
    candidateResolution?: string;
    candidateResolutionPhase?: string;
    candidateResolutionEvidenceChunkIds?: string[];
    compilerTaskSummary?: string;
    compilerTaskSummaryConfidence?: number;
    project?: string;
    currentTask?: string;
    nextAction?: string;
    blocker?: string;
    lastEmittedOutcomeKey?: string;
    linkedEventIds?: string[];
}): string;
export declare function buildTaskSummaryEvidenceSet(params: {
    eventRepo: {
        search(args: {
            agentId: string;
            scopes: string[];
            limit?: number;
            since?: string;
            readEpoch?: number;
        }): NormalizedEvent[];
    };
    task: ConversationTask;
    chunks: ConversationChunk[];
    now: string;
    readEpoch?: number;
}): TaskSummaryEvidenceSet;
export declare function resolveWorkingTaskSummary(params: {
    task: ConversationTask;
    chunks: ConversationChunk[];
    taskProposal?: TurnSemanticTaskProposal;
    observedAt: string;
}): WorkingTaskSummaryResolution;
export declare function taskSummaryNeedsUpgrade(params: {
    task: ConversationTask;
    evidence: TaskSummaryEvidenceSet;
    now: string;
}): boolean;
export declare function taskSummaryUpgradePriority(params: {
    task: ConversationTask;
    evidence: TaskSummaryEvidenceSet;
}): number;
