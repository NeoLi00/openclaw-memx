import type { MemxStoreBundle } from "../runtime.js";
import { normalizeText, randomId, truncateText } from "../support.js";
import type {
  ClassifiedCandidate,
  MemoryCandidate,
  MemoryCandidateStructuredHints,
  MemoryOperationContext,
  SourceSegmentRecord,
  TurnSemanticFrame,
} from "../types.js";
import { classifyAction } from "./classify.js";
import { computeConfidence } from "./normalize.js";
import { evaluatePolicy } from "./policy.js";
import {
  buildLongTurnSemanticScanInputFromSegments,
  frameHintsForSourceRef,
} from "./turnSemanticCompiler.js";
import { writeCandidate } from "./write.js";

export type SourceSegmentSemanticExtractionStats = {
  sourceGroupsConsidered: number;
  sourceGroupsScanned: number;
  candidatesWritten: number;
  skippedReasons: string[];
};

function emptyStats(): SourceSegmentSemanticExtractionStats {
  return {
    sourceGroupsConsidered: 0,
    sourceGroupsScanned: 0,
    candidatesWritten: 0,
    skippedReasons: [],
  };
}

function sourceRefsForSegments(segments: SourceSegmentRecord[]): string[] {
  return [...new Set(segments.map((segment) => segment.parentSourceRef).filter(Boolean))];
}

function fallbackTurnFrame(sourceRefs: string[]): TurnSemanticFrame {
  return {
    sourceRefs,
    chunkDrafts: [],
    assertionDrafts: [],
    correctionDrafts: [],
    relationDrafts: [],
    resourceAssertions: [],
    adviceSignals: [],
    supportSpans: [],
    compilerProvenance: {
      source: "deterministic",
      mode: "fallback",
      reasons: ["maintenance-source-segment-scaffold"],
    },
  };
}

function mergeMaintenanceFrame(
  fallback: TurnSemanticFrame,
  patch: Partial<TurnSemanticFrame>,
): TurnSemanticFrame {
  return {
    ...fallback,
    ...patch,
    sourceRefs:
      patch.sourceRefs && patch.sourceRefs.length > 0 ? patch.sourceRefs : fallback.sourceRefs,
    chunkDrafts: patch.chunkDrafts ?? [],
    taskProposal: patch.taskProposal,
    assertionDrafts: patch.assertionDrafts ?? [],
    correctionDrafts: patch.correctionDrafts ?? [],
    relationDrafts: patch.relationDrafts ?? [],
    resourceAssertions: patch.resourceAssertions ?? [],
    adviceSignals: patch.adviceSignals ?? [],
    supportSpans: patch.supportSpans ?? [],
    compilerProvenance: patch.compilerProvenance ?? {
      source: "llm",
      mode: "llm",
      reasons: ["maintenance-source-segment-semantic-extraction"],
    },
  };
}

function segmentsBySourceRef(segments: SourceSegmentRecord[]): Map<string, SourceSegmentRecord[]> {
  const grouped = new Map<string, SourceSegmentRecord[]>();
  for (const segment of segments) {
    const current = grouped.get(segment.parentSourceRef) ?? [];
    current.push(segment);
    grouped.set(segment.parentSourceRef, current);
  }
  return grouped;
}

function uniqueTexts(texts: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const text of texts.map((entry) => entry.trim()).filter(Boolean)) {
    const key = normalizeText(text);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(text);
  }
  return result;
}

function candidateTextFromHints(hints: MemoryCandidateStructuredHints): string {
  const draft = hints.semanticDraft;
  const parts = [
    ...(draft?.supportSpans ?? []).map((entry) => entry.text),
    ...(draft?.assertionDrafts ?? []).map((entry) =>
      [
        entry.familyHint,
        entry.timeframeHint,
        ...(entry.entityHints ?? []).map((entity) => entity.name),
        ...(entry.slotHints ?? []),
      ]
        .filter(Boolean)
        .join(" "),
    ),
    ...(draft?.correctionDrafts ?? []).map((entry) =>
      [
        "correction",
        entry.correction.targetKind,
        entry.correction.priorValue,
        entry.correction.nextValue,
        entry.correction.reason,
      ]
        .filter(Boolean)
        .join(" "),
    ),
    ...(draft?.relationDrafts ?? []).map((entry) =>
      [
        entry.relation.subject,
        entry.relation.predicate,
        entry.relation.object,
        entry.relation.reason,
      ]
        .filter(Boolean)
        .join(" "),
    ),
    ...(hints.resourceAssertions ?? []).map((entry) =>
      [
        entry.owner,
        entry.ownershipStatus,
        entry.resource,
        entry.supportText,
        ...(entry.domains ?? []),
        ...(entry.affordances ?? []),
      ]
        .filter(Boolean)
        .join(" "),
    ),
    ...(hints.adviceSignals ?? []).map((entry) =>
      [
        entry.problemContext,
        ...(entry.userResources ?? []),
        entry.assistantRecommendation,
        ...(entry.domains ?? []),
        entry.supportText,
      ]
        .filter(Boolean)
        .join(" "),
    ),
  ];
  return truncateText(uniqueTexts(parts).join(" | "), 900);
}

function candidateForSourceRef(params: {
  sourceRef: string;
  segments: SourceSegmentRecord[];
  hints: MemoryCandidateStructuredHints;
  frame: TurnSemanticFrame;
  ctx: MemoryOperationContext;
}): MemoryCandidate | null {
  const first = params.segments[0];
  if (!first) {
    return null;
  }
  const rawText = candidateTextFromHints(params.hints);
  if (!rawText) {
    return null;
  }
  return {
    candidateId: randomId("candidate"),
    source: {
      kind: first.role,
      messageId: first.turnId,
      toolName: first.toolName,
      sessionKey: first.sessionKey,
      runId: params.ctx.runId,
    },
    observedAt: first.createdAt,
    rawText,
    eventType: "maintenance_source_segment_semantics",
    structuredHints: params.hints,
    metadata: {
      sourceRef: params.sourceRef,
      generatedFrom: "maintenance_source_segment_semantic_extraction",
      sourceGroupId: first.sourceGroupId,
      segmentRefs: params.segments.map((segment) => segment.segmentId),
      segmentCount: params.segments.length,
      rawContentLength: Math.max(...params.segments.map((segment) => segment.charEnd)),
      turnId: first.turnId,
      sessionKey: first.sessionKey,
      turnSemanticCompiler: params.frame.compilerProvenance,
      turnSemanticFrame: params.frame,
    },
  };
}

export async function runSourceSegmentSemanticExtraction(
  store: MemxStoreBundle,
  ctx: MemoryOperationContext,
  params: { sessionKey?: string; turnIds: string[] },
): Promise<SourceSegmentSemanticExtractionStats> {
  const stats = emptyStats();
  if (params.turnIds.length === 0) {
    return stats;
  }
  if (!store.reasoner.isEnabled?.() || !store.reasoner.compileLongTurnSemantics) {
    stats.skippedReasons.push("llm-unavailable");
    return stats;
  }
  const segments = store.sourceSegmentRepo.listByTurnIds({
    agentId: ctx.agentId,
    scopes: ctx.scopes,
    sessionKey: params.sessionKey,
    turnIds: params.turnIds,
    limit: 256,
  });
  const grouped = segmentsBySourceRef(segments);
  stats.sourceGroupsConsidered = grouped.size;
  const scanInput = buildLongTurnSemanticScanInputFromSegments(segments);
  stats.sourceGroupsScanned = scanInput.messages.length;
  if (scanInput.messages.length === 0) {
    return stats;
  }

  const fallback = fallbackTurnFrame(sourceRefsForSegments(segments));
  const patch = await store.reasoner.compileLongTurnSemantics(scanInput, fallback, {
    stage: "maintenance_async",
    audit: ctx.llmBudgetAudit,
  });
  if (!patch) {
    stats.skippedReasons.push("llm-empty");
    return stats;
  }
  const frame = mergeMaintenanceFrame(fallback, patch);
  for (const sourceRef of frame.sourceRefs) {
    const hints = frameHintsForSourceRef(frame, sourceRef);
    const sourceSegments = grouped.get(sourceRef);
    if (!hints || !sourceSegments || sourceSegments.length === 0) {
      continue;
    }
    const candidate = candidateForSourceRef({
      sourceRef,
      segments: sourceSegments,
      hints,
      frame,
      ctx,
    });
    if (!candidate) {
      stats.skippedReasons.push(`empty-candidate:${sourceRef}`);
      continue;
    }
    const policyResult = await evaluatePolicy(candidate, ctx, {
      reasoner: store.reasoner,
    });
    const classification = classifyAction(policyResult.decision.action);
    if (classification === "ignore") {
      stats.skippedReasons.push(`policy-ignore:${sourceRef}`);
      continue;
    }
    const classified: ClassifiedCandidate = {
      ...policyResult.candidate,
      normalizedText: normalizeText(policyResult.candidate.rawText),
      scope: sourceSegments[0]?.scope ?? ctx.scopes[0] ?? `agent:${ctx.agentId}`,
      policy: policyResult.decision,
      classification,
      confidence: 0,
    };
    classified.confidence = computeConfidence(classified);
    writeCandidate(store, ctx, classified);
    stats.candidatesWritten += 1;
  }
  return stats;
}
