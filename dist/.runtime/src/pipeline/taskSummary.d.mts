import { ConversationChunk, ConversationTask, NormalizedEvent, TurnSemanticTaskProposal } from "../types.mjs";

//#region src/pipeline/taskSummary.d.ts
type TaskSummarySource = "compiler" | "llm_unavailable" | "heuristic_fallback" | "maintenance_llm";
type TaskSummaryQuality = "working" | "stable";
type TaskSummaryEvidenceEvent = {
  eventId: string;
  eventType: string;
  summary: string;
  observedAt: string;
  sourceRef: string;
};
type TaskSummaryEvidenceSet = {
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
type WorkingTaskSummaryResolution = {
  title: string;
  summary: string;
  metadataJson: Record<string, unknown>;
  summarySource: TaskSummarySource;
  summaryQuality: TaskSummaryQuality;
  summaryBasisFingerprint: string;
  compilerTaskSummary?: string;
  compilerTaskSummaryConfidence?: number;
};
declare function taskSummarySource(metadataJson: Record<string, unknown> | undefined): TaskSummarySource | undefined;
declare function taskSummaryQuality(metadataJson: Record<string, unknown> | undefined): TaskSummaryQuality | undefined;
declare function taskSummarySupportsSemanticConsumers(metadataJson: Record<string, unknown> | undefined): boolean;
declare function semanticTaskSummaryText(task: {
  summary: string;
  metadataJson?: Record<string, unknown>;
}): string | undefined;
declare function taskSummaryMetadataFields(params: {
  summarySource: TaskSummarySource;
  summaryQuality: TaskSummaryQuality;
  summaryBasisFingerprint: string;
  observedAt: string;
  compilerTaskSummary?: string;
  compilerTaskSummaryConfidence?: number;
}): Record<string, unknown>;
declare function computeTaskSummaryBasisFingerprint(params: {
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
declare function buildTaskSummaryEvidenceSet(params: {
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
declare function resolveWorkingTaskSummary(params: {
  task: ConversationTask;
  chunks: ConversationChunk[];
  taskProposal?: TurnSemanticTaskProposal;
  observedAt: string;
}): WorkingTaskSummaryResolution;
declare function taskSummaryNeedsUpgrade(params: {
  task: ConversationTask;
  evidence: TaskSummaryEvidenceSet;
  now: string;
}): boolean;
declare function taskSummaryUpgradePriority(params: {
  task: ConversationTask;
  evidence: TaskSummaryEvidenceSet;
}): number;
//#endregion
export { TaskSummaryEvidenceSet };