import type {
  ConversationChunk,
  ConversationTask,
  NormalizedEvent,
  TurnSemanticTaskProposal,
} from "../types.js";
import { objectRecord, stableHash } from "../support.js";
import { sanitizeTaskMetadata } from "./authority.js";
import { isQuestionLike } from "./semantics.js";

export type TaskSummarySource =
  | "compiler"
  | "llm_unavailable"
  | "heuristic_fallback"
  | "maintenance_llm";
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

function metadataString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringSet(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      continue;
    }
    const trimmed = entry.trim();
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
}

function normalizeTaskSummarySourceValue(value: unknown): TaskSummarySource | undefined {
  if (
    value === "compiler" ||
    value === "llm_unavailable" ||
    value === "heuristic_fallback" ||
    value === "maintenance_llm"
  ) {
    return value;
  }
  if (value === "heuristic") {
    return "heuristic_fallback";
  }
  if (value === "llm") {
    return "maintenance_llm";
  }
  return undefined;
}

function normalizeTaskSummaryQualityValue(value: unknown): TaskSummaryQuality | undefined {
  return value === "working" || value === "stable" ? value : undefined;
}

export function taskSummarySource(
  metadataJson: Record<string, unknown> | undefined,
): TaskSummarySource | undefined {
  return normalizeTaskSummarySourceValue(objectRecord(metadataJson)?.summarySource);
}

export function taskSummaryQuality(
  metadataJson: Record<string, unknown> | undefined,
): TaskSummaryQuality | undefined {
  return normalizeTaskSummaryQualityValue(objectRecord(metadataJson)?.summaryQuality);
}

export function taskSummarySupportsSemanticConsumers(
  metadataJson: Record<string, unknown> | undefined,
): boolean {
  const source = taskSummarySource(metadataJson);
  return source === "compiler" || source === "maintenance_llm";
}

export function semanticTaskSummaryText(task: {
  summary: string;
  metadataJson?: Record<string, unknown>;
}): string | undefined {
  return taskSummarySupportsSemanticConsumers(task.metadataJson)
    ? metadataString(task.summary)
    : undefined;
}

export function taskSummaryMetadataFields(params: {
  summarySource: TaskSummarySource;
  summaryQuality: TaskSummaryQuality;
  summaryBasisFingerprint: string;
  observedAt: string;
  compilerTaskSummary?: string;
  compilerTaskSummaryConfidence?: number;
}): Record<string, unknown> {
  return {
    summarySource: params.summarySource,
    summaryQuality: params.summaryQuality,
    summaryBasisFingerprint: params.summaryBasisFingerprint,
    summaryUpdatedAt: params.observedAt,
    ...(params.compilerTaskSummary
      ? { compilerTaskSummary: params.compilerTaskSummary }
      : {}),
    ...(typeof params.compilerTaskSummaryConfidence === "number"
      ? { compilerTaskSummaryConfidence: params.compilerTaskSummaryConfidence }
      : {}),
  };
}

function compilerSummaryFromProposal(
  taskProposal: TurnSemanticTaskProposal | undefined,
  existingMetadata: Record<string, unknown> | undefined,
): { summary: string; confidence?: number } | undefined {
  const proposalSummary = metadataString(taskProposal?.summary);
  if (proposalSummary) {
    return {
      summary: proposalSummary,
      ...(typeof taskProposal?.summaryConfidence === "number"
        ? { confidence: taskProposal.summaryConfidence }
        : {}),
    };
  }
  const metadata = objectRecord(existingMetadata);
  const persistedSummary = metadataString(metadata?.compilerTaskSummary);
  if (!persistedSummary) {
    return undefined;
  }
  const confidence =
    typeof metadata?.compilerTaskSummaryConfidence === "number"
      ? metadata.compilerTaskSummaryConfidence
      : undefined;
  return {
    summary: persistedSummary,
    ...(typeof confidence === "number" ? { confidence } : {}),
  };
}

function isAcceptableCompilerSummary(summary: string, confidence?: number): boolean {
  const normalized = summary.trim();
  if (!normalized || normalized.length < 12) {
    return false;
  }
  if (isQuestionLike(normalized)) {
    return false;
  }
  if (/^(?:active task|conversation task|当前任务|对话任务)$/iu.test(normalized)) {
    return false;
  }
  if (typeof confidence === "number" && confidence < 0.42) {
    return false;
  }
  return true;
}

function recentSinceIso(now: string, days: number): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function structuredEventSummary(event: NormalizedEvent): string {
  const metadata = objectRecord(event.metadataJson);
  const memxTemporalFacet = objectRecord(metadata?.memxTemporalFacet);
  return (
    metadataString(memxTemporalFacet?.summary) ??
    metadataString(metadata?.memxStructuredSummary) ??
    event.text
  );
}

export function computeTaskSummaryBasisFingerprint(params: {
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
}): string {
  return stableHash([
    params.taskId,
    ...params.chunkIds,
    params.candidateResolution ?? "",
    params.candidateResolutionPhase ?? "",
    ...(params.candidateResolutionEvidenceChunkIds ?? []),
    params.compilerTaskSummary ?? "",
    typeof params.compilerTaskSummaryConfidence === "number"
      ? params.compilerTaskSummaryConfidence.toFixed(3)
      : "",
    params.project ?? "",
    params.currentTask ?? "",
    params.nextAction ?? "",
    params.blocker ?? "",
    params.lastEmittedOutcomeKey ?? "",
    ...(params.linkedEventIds ?? []),
  ]);
}

export function buildTaskSummaryEvidenceSet(params: {
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
}): TaskSummaryEvidenceSet {
  const rawMetadata = objectRecord(params.task.metadataJson);
  const canonicalMetadata = sanitizeTaskMetadata(params.task.metadataJson);
  const compilerTaskSummary = compilerSummaryFromProposal(undefined, rawMetadata);
  const candidateResolution = metadataString(rawMetadata?.candidateResolution);
  const candidateResolutionPhase = metadataString(rawMetadata?.candidateResolutionPhase);
  const candidateResolutionEvidenceChunkIds = stringSet(rawMetadata?.candidateResolutionEvidenceChunkIds);
  const lastEmittedOutcomeKey = metadataString(rawMetadata?.lastEmittedOutcomeKey);
  const chunkIds = params.chunks.map((chunk) => chunk.chunkId);
  const chunkIdSet = new Set(chunkIds);
  const recentEvents = params.eventRepo.search({
    agentId: params.task.agentId,
    scopes: [params.task.scope],
    limit: 48,
    since: recentSinceIso(params.now, 21),
    ...(typeof params.readEpoch === "number" ? { readEpoch: params.readEpoch } : {}),
  });
  const linkedEvents = recentEvents
    .filter((event) => {
      const metadata = objectRecord(event.metadataJson);
      if (metadataString(metadata?.taskId) === params.task.taskId) {
        return true;
      }
      const evidenceChunkIds = stringSet(metadata?.evidenceChunkIds);
      if (evidenceChunkIds.some((chunkId) => chunkIdSet.has(chunkId))) {
        return true;
      }
      return event.sourceRef.includes(params.task.taskId);
    })
    .slice(0, 6)
    .map((event) => ({
      eventId: event.eventId,
      eventType: event.eventType,
      summary: structuredEventSummary(event),
      observedAt: event.observedAt,
      sourceRef: event.sourceRef,
    }));
  const supportRefs = [
    `task:${params.task.taskId}`,
    ...chunkIds.map((chunkId) => `chunk:${chunkId}`),
    ...linkedEvents.map((event) => `event:${event.eventId}`),
  ];
  const fingerprint = computeTaskSummaryBasisFingerprint({
    taskId: params.task.taskId,
    chunkIds,
    candidateResolution,
    candidateResolutionPhase,
    candidateResolutionEvidenceChunkIds,
    compilerTaskSummary: compilerTaskSummary?.summary,
    compilerTaskSummaryConfidence: compilerTaskSummary?.confidence,
    project: canonicalMetadata.project,
    currentTask: canonicalMetadata.currentTask,
    nextAction: canonicalMetadata.nextAction,
    blocker: canonicalMetadata.blocker,
    lastEmittedOutcomeKey,
    linkedEventIds: linkedEvents.map((event) => event.eventId),
  });
  return {
    taskId: params.task.taskId,
    chunks: params.chunks,
    ...(compilerTaskSummary ? { compilerTaskSummary } : {}),
    ...(candidateResolution ? { candidateResolution } : {}),
    ...(candidateResolutionPhase ? { candidateResolutionPhase } : {}),
    candidateResolutionEvidenceChunkIds,
    ...(canonicalMetadata.project ? { project: canonicalMetadata.project } : {}),
    ...(canonicalMetadata.currentTask ? { currentTask: canonicalMetadata.currentTask } : {}),
    ...(canonicalMetadata.nextAction ? { nextAction: canonicalMetadata.nextAction } : {}),
    ...(canonicalMetadata.blocker ? { blocker: canonicalMetadata.blocker } : {}),
    ...(lastEmittedOutcomeKey ? { lastEmittedOutcomeKey } : {}),
    linkedEvents,
    supportRefs,
    fingerprint,
  };
}

export function resolveWorkingTaskSummary(params: {
  task: ConversationTask;
  chunks: ConversationChunk[];
  taskProposal?: TurnSemanticTaskProposal;
  observedAt: string;
}): WorkingTaskSummaryResolution {
  const compilerTaskSummary = compilerSummaryFromProposal(
    params.taskProposal,
    params.task.metadataJson,
  );
  const compilerSummary =
    compilerTaskSummary && isAcceptableCompilerSummary(compilerTaskSummary.summary, compilerTaskSummary.confidence)
      ? compilerTaskSummary.summary
      : undefined;
  const compilerSummaryConfidence = compilerSummary ? compilerTaskSummary?.confidence : undefined;
  const summarySource: TaskSummarySource = compilerSummary ? "compiler" : "llm_unavailable";
  const summaryBasisFingerprint = computeTaskSummaryBasisFingerprint({
    taskId: params.task.taskId,
    chunkIds: params.chunks.map((chunk) => chunk.chunkId),
    candidateResolution:
      typeof params.task.metadataJson?.candidateResolution === "string"
        ? params.task.metadataJson.candidateResolution
        : undefined,
    candidateResolutionPhase:
      typeof params.task.metadataJson?.candidateResolutionPhase === "string"
        ? params.task.metadataJson.candidateResolutionPhase
        : undefined,
    candidateResolutionEvidenceChunkIds: stringSet(
      objectRecord(params.task.metadataJson)?.candidateResolutionEvidenceChunkIds,
    ),
    compilerTaskSummary: compilerSummary ?? compilerTaskSummary?.summary,
    compilerTaskSummaryConfidence: compilerSummaryConfidence ?? compilerTaskSummary?.confidence,
    lastEmittedOutcomeKey:
      typeof params.task.metadataJson?.lastEmittedOutcomeKey === "string"
        ? params.task.metadataJson.lastEmittedOutcomeKey
        : undefined,
  });
  return {
    title: params.task.title || "Active task",
    summary: compilerSummary ?? params.task.summary ?? "",
    metadataJson: {
      ...taskSummaryMetadataFields({
        summarySource,
        summaryQuality: "working",
        summaryBasisFingerprint,
        observedAt: params.observedAt,
        ...(compilerTaskSummary?.summary
          ? {
              compilerTaskSummary: compilerTaskSummary.summary,
              compilerTaskSummaryConfidence: compilerTaskSummary.confidence,
            }
          : {}),
      }),
    },
    summarySource,
    summaryQuality: "working",
    summaryBasisFingerprint,
    ...(compilerTaskSummary?.summary ? { compilerTaskSummary: compilerTaskSummary.summary } : {}),
    ...(typeof compilerTaskSummary?.confidence === "number"
      ? { compilerTaskSummaryConfidence: compilerTaskSummary.confidence }
      : {}),
  };
}

export function taskSummaryNeedsUpgrade(params: {
  task: ConversationTask;
  evidence: TaskSummaryEvidenceSet;
  now: string;
}): boolean {
  if (params.evidence.chunks.length === 0) {
    return false;
  }
  const metadata = objectRecord(params.task.metadataJson);
  const source = taskSummarySource(metadata);
  const quality = taskSummaryQuality(metadata);
  const currentFingerprint = metadataString(metadata?.summaryBasisFingerprint);
  const summaryUpdatedAt = metadataString(metadata?.summaryUpdatedAt) ?? params.task.updatedAt;
  const currentMs = Date.parse(params.now);
  const updatedMs = Date.parse(summaryUpdatedAt);
  const hoursSinceSummaryUpdate =
    Number.isFinite(currentMs) && Number.isFinite(updatedMs)
      ? Math.max(0, (currentMs - updatedMs) / (60 * 60 * 1000))
      : 0;
  const hasChangedEvidence = currentFingerprint !== params.evidence.fingerprint;
  const highValueEvidence =
    Boolean(params.evidence.candidateResolution) ||
    params.evidence.candidateResolutionEvidenceChunkIds.length > 0 ||
    Boolean(params.evidence.lastEmittedOutcomeKey) ||
    params.evidence.linkedEvents.length > 0 ||
    params.evidence.chunks.some((chunk) => chunk.role === "tool") ||
    params.evidence.chunks.length >= 5;
  if (!highValueEvidence) {
    return false;
  }
  if (source === "heuristic_fallback" || source === "llm_unavailable" || !source) {
    return true;
  }
  if (quality !== "stable") {
    return true;
  }
  if (hasChangedEvidence && hoursSinceSummaryUpdate >= 1) {
    return true;
  }
  if (hoursSinceSummaryUpdate >= 24 && params.evidence.linkedEvents.length > 0) {
    return true;
  }
  return false;
}

export function taskSummaryUpgradePriority(params: {
  task: ConversationTask;
  evidence: TaskSummaryEvidenceSet;
}): number {
  const metadata = objectRecord(params.task.metadataJson);
  const source = taskSummarySource(metadata);
  const toolCount = params.evidence.chunks.filter((chunk) => chunk.role === "tool").length;
  return (
    (source === "heuristic_fallback" || source === "llm_unavailable" || !source ? 3 : 0) +
    (params.evidence.candidateResolution ? 3 : 0) +
    (params.evidence.lastEmittedOutcomeKey ? 2 : 0) +
    (params.evidence.linkedEvents.length > 0 ? 2 : 0) +
    (params.evidence.compilerTaskSummary ? 1.5 : 0) +
    (toolCount > 0 ? 1.5 : 0) +
    Math.min(params.evidence.chunks.length, 8) * 0.08
  );
}
