import { clamp01, normalizeText, stableHash } from "../support.js";
import type {
  AbstractionCandidateRecord,
  ClassifiedCandidate,
  ConversationChunk,
  ConversationTask,
  ConversationTaskPhase,
  SynthesizedTaskEvent,
} from "../types.js";

type OutcomeEvidenceStats = {
  assistantCount: number;
  userCount: number;
  toolCount: number;
  hasUserEvidence: boolean;
  hasToolEvidence: boolean;
  hasNonAssistantGrounding: boolean;
};

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function stageValue(value: unknown): AbstractionCandidateRecord["stage"] | undefined {
  return value === "candidate" ||
    value === "probationary" ||
    value === "active" ||
    value === "decaying" ||
    value === "quarantined" ||
    value === "superseded"
    ? value
    : undefined;
}

export function isAuthoritativeOutcomeResolutionMetadata(
  metadata: Record<string, unknown> | undefined,
): boolean {
  if (!metadata) {
    return false;
  }
  const stage = stageValue(
    metadata.candidateOutcomeHypothesisStage ?? metadata.stage ?? metadata.candidateStage,
  );
  const hasUserEvidence = booleanValue(
    metadata.candidateOutcomeHasUserEvidence ?? metadata.hasUserEvidence,
  );
  const hasToolEvidence = booleanValue(
    metadata.candidateOutcomeHasToolEvidence ?? metadata.hasToolEvidence,
  );
  const hasNonAssistantGrounding = booleanValue(
    metadata.candidateOutcomeHasNonAssistantGrounding ??
      metadata.hasNonAssistantGrounding ??
      (hasUserEvidence || hasToolEvidence),
  );
  const judgeShouldPromote = booleanValue(
    metadata.candidateOutcomeJudgeShouldPromote ?? metadata.judgeShouldPromote,
  );
  const phase = stringValue(metadata.candidateResolutionPhase ?? metadata.phase);
  const strongPhase = phase === "validated" || phase === "resolved";
  return (
    hasNonAssistantGrounding &&
    (judgeShouldPromote || strongPhase || stage === "probationary" || stage === "active")
  );
}

export type OutcomeHypothesisDecisionSnapshot = {
  shouldPromote: boolean;
  promotionScore: number;
  reason: string;
};

export type OutcomeHypothesisCandidateMetadata = {
  taskId: string;
  sessionKey: string;
  outcomeKey: string;
  eventType: string;
  phase: ConversationTaskPhase;
  evidenceChunkIds: string[];
  observedAt: string;
  closureScore: number;
  verificationScore: number;
  contradictionRisk: number;
  confidence: number;
  promotionScore: number;
  judgeShouldPromote: boolean;
  judgeReason: string;
  assistantCount: number;
  userCount: number;
  toolCount: number;
  hasUserEvidence: boolean;
  hasToolEvidence: boolean;
  hasNonAssistantGrounding: boolean;
  generatedFrom: "assistant_outcome_hypothesis";
  frameworkRound: 5;
};

function collectOutcomeEvidenceStats(chunks: ConversationChunk[]): OutcomeEvidenceStats {
  const assistantCount = chunks.filter((chunk) => chunk.role === "assistant").length;
  const userCount = chunks.filter((chunk) => chunk.role === "user").length;
  const toolCount = chunks.filter((chunk) => chunk.role === "tool").length;
  return {
    assistantCount,
    userCount,
    toolCount,
    hasUserEvidence: userCount > 0,
    hasToolEvidence: toolCount > 0,
    hasNonAssistantGrounding: userCount > 0 || toolCount > 0,
  };
}

function inferOutcomeHypothesisStage(params: {
  outcome: SynthesizedTaskEvent;
  decision: OutcomeHypothesisDecisionSnapshot;
  evidence: OutcomeEvidenceStats;
}): AbstractionCandidateRecord["stage"] {
  const strongPhase = params.outcome.phase === "validated" || params.outcome.phase === "resolved";
  const probationaryScore = clamp01(
    params.decision.promotionScore * 0.42 +
      params.outcome.verificationScore * 0.22 +
      params.outcome.closureScore * 0.18 +
      (params.evidence.hasToolEvidence ? 0.12 : params.evidence.hasUserEvidence ? 0.08 : 0) +
      (strongPhase ? 0.12 : 0.04) -
      params.outcome.contradictionRisk * 0.26,
  );
  if (
    params.evidence.hasNonAssistantGrounding &&
    strongPhase &&
    (params.decision.shouldPromote || probationaryScore >= 0.72) &&
    params.outcome.contradictionRisk <= 0.34
  ) {
    return "probationary";
  }
  return "candidate";
}

export function buildOutcomeEventCandidate(
  task: ConversationTask,
  proposal: SynthesizedTaskEvent,
  observedAt: string,
): ClassifiedCandidate {
  return {
    candidateId: stableHash([task.taskId, proposal.outcomeKey, observedAt, "outcome-event"]),
    source: {
      kind: "assistant",
      sessionKey: task.sessionKey,
      messageId: task.taskId,
    },
    observedAt,
    rawText: proposal.summary,
    normalizedText: normalizeText(proposal.summary),
    eventType: proposal.eventType,
    structuredHints: {
      entities: [],
      timeHints: [],
      preferenceHint: false,
      decisionHint: false,
      relationHint: false,
      taskStateHint: true,
    },
    metadata: {
      taskId: task.taskId,
      synthesizedFromTask: true,
      outcomeKey: proposal.outcomeKey,
      evidenceChunkIds: proposal.evidenceChunkIds,
      phase: proposal.phase,
      closureScore: proposal.closureScore,
      verificationScore: proposal.verificationScore,
      contradictionRisk: proposal.contradictionRisk,
      promotionScore: proposal.promotionScore,
    },
    scope: task.scope,
    policy: {
      salienceScore: proposal.closureScore,
      expectedFutureUtility: proposal.verificationScore,
      sensitivityScore: 0,
      stabilityScore: proposal.confidence,
      action: "episodic_event",
      reasons: ["task synthesis outcome promotion"],
      explicitIntent: false,
      captureAuthorized: true,
    },
    classification: "episodic-event",
    confidence: proposal.confidence,
  };
}

export function buildOutcomeHypothesisCandidate(params: {
  agentId: string;
  task: ConversationTask;
  outcome: SynthesizedTaskEvent;
  observedAt: string;
  evidenceChunks: ConversationChunk[];
  decision: OutcomeHypothesisDecisionSnapshot;
}): AbstractionCandidateRecord {
  const evidence = collectOutcomeEvidenceStats(params.evidenceChunks);
  const stage = inferOutcomeHypothesisStage({
    outcome: params.outcome,
    decision: params.decision,
    evidence,
  });
  const confidence = clamp01(
    params.outcome.confidence * 0.32 +
      params.decision.promotionScore * 0.28 +
      params.outcome.verificationScore * 0.16 +
      params.outcome.closureScore * 0.12 +
      (evidence.hasToolEvidence ? 0.12 : evidence.hasUserEvidence ? 0.08 : 0.03) -
      params.outcome.contradictionRisk * 0.16,
  );
  const usefulnessScore = clamp01(
    params.decision.promotionScore * 0.34 +
      params.outcome.verificationScore * 0.28 +
      params.outcome.closureScore * 0.12 +
      (evidence.hasNonAssistantGrounding ? 0.16 : 0.04) +
      (evidence.hasToolEvidence ? 0.1 : 0),
  );
  const stabilityScore = clamp01(
    params.outcome.confidence * 0.24 +
      params.outcome.closureScore * 0.18 +
      params.outcome.verificationScore * 0.18 +
      (evidence.hasNonAssistantGrounding ? 0.2 : 0.05) +
      (params.outcome.phase === "validated" || params.outcome.phase === "resolved" ? 0.14 : 0.06) +
      (params.decision.shouldPromote ? 0.06 : 0),
  );
  const contradictionScore = clamp01(
    params.outcome.contradictionRisk * 0.88 + (evidence.hasNonAssistantGrounding ? 0 : 0.06),
  );
  const metadata: OutcomeHypothesisCandidateMetadata = {
    taskId: params.task.taskId,
    sessionKey: params.task.sessionKey,
    outcomeKey: params.outcome.outcomeKey,
    eventType: params.outcome.eventType,
    phase: params.outcome.phase,
    evidenceChunkIds: params.outcome.evidenceChunkIds,
    observedAt: params.observedAt,
    closureScore: params.outcome.closureScore,
    verificationScore: params.outcome.verificationScore,
    contradictionRisk: params.outcome.contradictionRisk,
    confidence: params.outcome.confidence,
    promotionScore: params.decision.promotionScore,
    judgeShouldPromote: params.decision.shouldPromote,
    judgeReason: params.decision.reason,
    assistantCount: evidence.assistantCount,
    userCount: evidence.userCount,
    toolCount: evidence.toolCount,
    hasUserEvidence: evidence.hasUserEvidence,
    hasToolEvidence: evidence.hasToolEvidence,
    hasNonAssistantGrounding: evidence.hasNonAssistantGrounding,
    generatedFrom: "assistant_outcome_hypothesis",
    frameworkRound: 5,
  };
  return {
    candidateId: stableHash([params.task.taskId, params.outcome.outcomeKey, "outcome_hypothesis"]),
    agentId: params.agentId,
    scope: params.task.scope,
    abstractionType: "outcome_hypothesis",
    semanticKey: `outcome_hypothesis:${params.task.scope}:${params.task.taskId}:${params.outcome.outcomeKey}`,
    summary: params.outcome.summary,
    supportContentRefs: [
      `task:${params.task.taskId}`,
      ...params.outcome.evidenceChunkIds.map((chunkId) => `chunk:${chunkId}`),
    ],
    supportBeliefIds: [],
    confidence,
    usefulnessScore,
    stabilityScore,
    contradictionScore,
    stage,
    metadataJson: metadata,
    createdAt: params.observedAt,
    updatedAt: params.observedAt,
  };
}
