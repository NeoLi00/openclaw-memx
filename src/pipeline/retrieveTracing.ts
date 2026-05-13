import { truncateText } from "../support.js";
import type {
  BackgroundRecallBundle,
  EvidenceRow,
  MemoryRecallPlan,
  QueryCompileResult,
  RecallQueryShape,
  RecallBudgetPlan,
  RecallControllerTrace,
  RecallProbeDecision,
  RecallQualityGateDecision,
  RecallSelectionTrace,
  TurnMode,
  ShallowRecallResult,
} from "../types.js";
import { semanticTextSimilarity } from "./semantic/textSimilarity.js";

export type RetrievalAuditOptions = {
  recallMode?: "full" | "background-only" | "no-recall";
  fullRecallTrigger?: "plan" | "probe" | "both" | "tool";
  plan?: MemoryRecallPlan;
  probe?: RecallProbeDecision;
  controller?: RecallControllerTrace;
  shallow?: ShallowRecallResult;
  qualityGate?: RecallQualityGateDecision;
  background?: BackgroundRecallBundle;
  budgetPlan?: RecallBudgetPlan;
  selectionTrace?: RecallSelectionTrace;
  queryAnalysis?: {
    queryShape: RecallQueryShape;
    routeWeights: Record<string, number> | Partial<Record<string, number>>;
    turnMode: TurnMode;
    answerGranularity?: QueryCompileResult["answerGranularity"];
    evidenceFidelity?: QueryCompileResult["evidenceFidelity"];
    candidateSurfaces?: QueryCompileResult["candidateSurfaces"];
    evidenceGoals?: QueryCompileResult["evidenceGoals"];
    supportNeed?: number;
    ambiguityLevel?: number;
    compilerProvenance?: QueryCompileResult["compilerProvenance"];
  };
};

export function summarizeBackgroundRecallBundle(bundle: BackgroundRecallBundle): {
  guidanceCount: number;
  strategyCount: number;
  stateIds: string[];
  taskIds: string[];
  projectionRoles: string[];
  projectionBlocks: Array<{
    blockId: string;
    role: string;
    title: string;
    sourceIds: string[];
    lineCount: number;
    charCount: number;
  }>;
} {
  return {
    guidanceCount: bundle.behavioralGuidance.length,
    strategyCount: bundle.strategyGuidance.length,
    stateIds: bundle.states.map((entry) => entry.id),
    taskIds: bundle.tasks.map((entry) => entry.id),
    projectionRoles: bundle.projectionBlocks.map((block) => block.role),
    projectionBlocks: bundle.projectionBlocks.map((block) => ({
      blockId: block.blockId,
      role: block.role,
      title: block.title,
      sourceIds: block.sourceIds,
      lineCount: block.lines.length,
      charCount: block.lines.join("\n").length,
    })),
  };
}

const GENERIC_RECALL_QUERIES = new Set([
  "memory query",
  "memory recall",
  "recall memory",
  "search memory",
  "context query",
  "history query",
  "previous context",
  "prior context",
  "conversation memory",
  "relevant memory",
  "user preferences",
  "remembered context",
  "记忆查询",
  "历史上下文",
  "相关记忆",
  "用户偏好",
]);

export function sanitizeFocusedRecallQuery(rawQuery: string, focusedQuery?: string): string {
  const raw = rawQuery.trim();
  const focused = focusedQuery?.trim();
  if (!focused) {
    return raw;
  }
  const normalizedFocused = focused.toLowerCase().replace(/\s+/g, " ");
  if (GENERIC_RECALL_QUERIES.has(normalizedFocused)) {
    return raw;
  }
  if (semanticTextSimilarity(raw, focused) < 0.18 && focused.length < raw.length * 0.7) {
    return raw;
  }
  return focused;
}

export function formatRecallProbeTrace(probe: RecallProbeDecision): string {
  const route = probe.hintedRoute ?? "none";
  const docType = probe.signals.topProbeDocType ?? "none";
  return [
    `score=${probe.probeScore.toFixed(2)}`,
    `escalate=${String(probe.shouldEscalate)}`,
    `route=${route}`,
    `task=${probe.signals.taskAssociation.toFixed(2)}`,
    `state=${probe.signals.stateAssociation.toFixed(2)}`,
    `context=${probe.signals.contextAssociation.toFixed(2)}`,
    `workflow=${probe.signals.workflowSimilarity.toFixed(2)}`,
    `factual=${probe.signals.factualSimilarity.toFixed(2)}`,
    `temporal=${probe.signals.temporalSimilarity.toFixed(2)}`,
    `explanatory=${probe.signals.explanatorySimilarity.toFixed(2)}`,
    `hybrid=${probe.signals.topProbeScore.toFixed(2)}/${docType}`,
    `thresholds=w${probe.thresholds.workflowStrong.toFixed(2)}/${probe.thresholds.workflowContinuation.toFixed(2)} f${probe.thresholds.factualStrong.toFixed(2)}/${probe.thresholds.factualShortQuery.toFixed(2)} h${probe.thresholds.hybridStrong.toFixed(2)}/${probe.thresholds.hybridModerate.toFixed(2)} e${probe.thresholds.escalate.toFixed(2)}/${probe.thresholds.continuationEscalate.toFixed(2)}`,
    `reasons=${probe.reasons.join(",")}`,
  ].join(" ");
}

export function formatRecallControllerTrace(controller: RecallControllerTrace): string {
  return [
    `need=${controller.needLevel}`,
    `legacy=${controller.legacyFullRecall ? "full" : "no-full"}/${controller.legacyTrigger}`,
    `route=${controller.routeHint ?? "unknown"}`,
    controller.queryShape
      ? `shape=${controller.queryShape.timeframe}/${controller.queryShape.granularity}/${controller.queryShape.referentialMode}/${controller.queryShape.evidenceNeed}`
      : "shape=unknown",
    `divergence=${controller.divergence ?? "aligned"}`,
    `signals=support:${controller.signals.routeSupport.toFixed(2)}/continuity:${controller.signals.workflowContinuity.toFixed(2)}/background:${String(controller.signals.backgroundContextAvailable)}/low:${String(controller.signals.lowSupportSurface)}/g${controller.signals.backgroundGuidanceCount}/sg${controller.signals.backgroundStrategyCount}/t${controller.signals.backgroundTaskCount}/s${controller.signals.backgroundStateCount}`,
    `reasons=${controller.reasons.join(",")}`,
  ].join(" ");
}

export function formatShallowRecallTrace(shallow: ShallowRecallResult): string {
  return [
    `route=${shallow.routeHint ?? "unknown"}`,
    `score=${shallow.topSupport.toFixed(2)}`,
    `hits=${shallow.hybridHitCount}`,
    `projection=${shallow.projectionRoles.join(",") || "none"}`,
    `reasons=${shallow.reasons.join(",")}`,
  ].join(" ");
}

export function formatRecallQualityGateTrace(gate: RecallQualityGateDecision): string {
  return [
    `decision=${gate.decision}`,
    `route=${gate.routeHint ?? "unknown"}`,
    `confidence=${gate.confidence.toFixed(2)}`,
    `metrics=support:${gate.metrics.supportDensity.toFixed(2)}/agreement:${gate.metrics.routeAgreement.toFixed(2)}/contradiction:${gate.metrics.contradictionPressure.toFixed(2)}/freshness:${gate.metrics.freshness.toFixed(2)}/grounding:${gate.metrics.grounding.toFixed(2)}/spill:${gate.metrics.irrelevantSpill.toFixed(2)}`,
    `focused="${truncateText(gate.focusedQuery, 72)}"`,
    `reasons=${gate.reasons.join(",")}`,
  ].join(" ");
}

export function buildRecallAuditPayload(
  options: RetrievalAuditOptions = {},
): Record<string, unknown> | undefined {
  if (
    !options.plan &&
    !options.probe &&
    !options.background &&
    !options.selectionTrace &&
    !options.recallMode &&
    !options.fullRecallTrigger
  ) {
    return undefined;
  }
  return {
    mode: options.recallMode ?? "full",
    fullRecallTrigger: options.fullRecallTrigger,
    plan: options.plan
      ? {
          shouldRecall: options.plan.shouldRecall,
          focusedQuery: options.plan.focusedQuery,
          reason: options.plan.reason,
          routeHint: options.plan.routeHint,
          judgmentMode: options.plan.judgmentMode,
        }
      : undefined,
    probe: options.probe
      ? {
          shouldEscalate: options.probe.shouldEscalate,
          probeScore: options.probe.probeScore,
          hintedRoute: options.probe.hintedRoute,
          focusedQuery: options.probe.focusedQuery,
          reasons: options.probe.reasons,
          signals: options.probe.signals,
          thresholds: options.probe.thresholds,
        }
      : undefined,
    controller: options.controller
      ? {
          needLevel: options.controller.needLevel,
          routeHint: options.controller.routeHint,
          queryShape: options.controller.queryShape,
          routeWeights: options.controller.routeWeights,
          shouldUseBackground: options.controller.shouldUseBackground,
          shouldUseShallow: options.controller.shouldUseShallow,
          shouldUseFull: options.controller.shouldUseFull,
          legacyTrigger: options.controller.legacyTrigger,
          legacyFullRecall: options.controller.legacyFullRecall,
          divergence: options.controller.divergence,
          reasons: options.controller.reasons,
          signals: options.controller.signals,
        }
      : undefined,
    shallow: options.shallow
      ? {
          searchQuery: options.shallow.searchQuery,
          routeHint: options.shallow.routeHint,
          topSupport: options.shallow.topSupport,
          hybridHitCount: options.shallow.hybridHitCount,
          projectionRoles: options.shallow.projectionRoles,
          reasons: options.shallow.reasons,
          routeSummaries: Object.fromEntries(
            Object.entries(options.shallow.routeSummaries).map(([routeType, summary]) => [
              routeType,
              {
                support: summary.support,
                candidateCount: summary.candidateCount,
                projectionSupport: summary.projectionSupport,
                freshness: summary.freshness,
                contradictionPressure: summary.contradictionPressure,
                grounding: summary.grounding,
                topKind: summary.topKind,
                topObjectId: summary.topObjectId,
              },
            ]),
          ),
        }
      : undefined,
    qualityGate: options.qualityGate
      ? {
          decision: options.qualityGate.decision,
          routeHint: options.qualityGate.routeHint,
          focusedQuery: options.qualityGate.focusedQuery,
          confidence: options.qualityGate.confidence,
          reasons: options.qualityGate.reasons,
          metrics: options.qualityGate.metrics,
        }
      : undefined,
    background: options.background
      ? summarizeBackgroundRecallBundle(options.background)
      : undefined,
    queryAnalysis: options.queryAnalysis
      ? {
          queryShape: options.queryAnalysis.queryShape,
          routeWeights: options.queryAnalysis.routeWeights,
          turnMode: options.queryAnalysis.turnMode,
          answerGranularity: options.queryAnalysis.answerGranularity,
          evidenceFidelity: options.queryAnalysis.evidenceFidelity,
          answerMode: options.queryAnalysis.answerMode,
          evidenceCoverage: options.queryAnalysis.evidenceCoverage,
          candidateSurfaces: options.queryAnalysis.candidateSurfaces,
          evidenceGoals: options.queryAnalysis.evidenceGoals,
          supportNeed: options.queryAnalysis.supportNeed,
          ambiguityLevel: options.queryAnalysis.ambiguityLevel,
          compilerProvenance: options.queryAnalysis.compilerProvenance,
        }
      : undefined,
    budgetPlan: options.budgetPlan
      ? {
          routeDecision: options.budgetPlan.routeDecision,
          totalObjectBudget: options.budgetPlan.totalObjectBudget,
          totalPromptChars: options.budgetPlan.totalPromptChars,
          reservedBackgroundChars: options.budgetPlan.reservedBackgroundChars,
          globalOverflowObjects: options.budgetPlan.globalOverflowObjects,
          routeEvaluations: options.budgetPlan.routeEvaluations.map((entry) => ({
            routeType: entry.routeType,
            finalScore: entry.finalScore,
            evidenceSupport: entry.evidenceSupport,
            evidenceSufficient: entry.evidenceSufficient,
            candidateCount: entry.candidateCount,
          })),
          objectiveBudgets: Object.fromEntries(
            Object.entries(options.budgetPlan.objectiveBudgets).map(([routeType, budget]) => [
              routeType,
              {
                weight: budget.weight,
                rawScore: budget.rawScore,
                activated: budget.activated,
                objectBudget: budget.objectBudget,
                promptChars: budget.promptChars,
                minObjects: budget.minObjects,
                minPromptChars: budget.minPromptChars,
              },
            ]),
          ),
        }
      : undefined,
    selectionTrace: options.selectionTrace
      ? {
          candidateCountsByRoute: options.selectionTrace.candidateCountsByRoute,
          reserveSelections: Object.fromEntries(
            Object.entries(options.selectionTrace.reserveSelections).map(([routeType, entries]) => [
              routeType,
              entries.map((entry) => ({
                objectId: entry.objectId,
                kind: entry.kind,
                weightedScore: entry.weightedScore,
                strongestRoute: entry.strongestRoute,
                selectionReason: entry.selectionReason,
              })),
            ]),
          ),
          overflowSelections: options.selectionTrace.overflowSelections.map((entry) => ({
            objectId: entry.objectId,
            kind: entry.kind,
            weightedScore: entry.weightedScore,
            strongestRoute: entry.strongestRoute,
            selectionReason: entry.selectionReason,
          })),
          droppedHighScore: options.selectionTrace.droppedHighScore.map((entry) => ({
            objectId: entry.objectId,
            kind: entry.kind,
            weightedScore: entry.weightedScore,
            strongestRoute: entry.strongestRoute,
            selectionReason: entry.selectionReason,
          })),
        }
      : undefined,
  };
}

export function compareEvidenceRowsChronologically(left: EvidenceRow, right: EvidenceRow): number {
  if (!left.observedAt && !right.observedAt) {
    return left.text.localeCompare(right.text) || left.id.localeCompare(right.id);
  }
  if (!left.observedAt) {
    return 1;
  }
  if (!right.observedAt) {
    return -1;
  }
  const observedDelta = left.observedAt.localeCompare(right.observedAt);
  if (observedDelta !== 0) {
    return observedDelta;
  }
  const textDelta = left.text.localeCompare(right.text);
  if (textDelta !== 0) {
    return textDelta;
  }
  return left.id.localeCompare(right.id);
}
