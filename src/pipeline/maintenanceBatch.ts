import type { MemxStoreBundle } from "../runtime.js";
import type { MaintenanceBatchMetadata, MemoryOperationContext } from "../types.js";
import { nowIso } from "../support.js";
import { runAbstractionJobs } from "./abstractionJobs.js";
import { runAbstractionPromotion } from "./abstractionPromotion.js";
import { runConsolidation } from "./consolidate.js";
import {
  runSourceSegmentSemanticExtraction,
  type SourceSegmentSemanticExtractionStats,
} from "./sourceSegmentSemanticExtraction.js";

export async function runAutomaticMaintenanceBatch(
  store: MemxStoreBundle,
  ctx: MemoryOperationContext,
  batch: MaintenanceBatchMetadata,
): Promise<void> {
  const sourceSegmentStartedAt = nowIso();
  const sourceSegmentRunId = store.auditRepo.startMaintenance({
    agentId: ctx.agentId,
    jobType: "source-segment-semantic-extraction",
    startedAt: sourceSegmentStartedAt,
    stats: {
      sessionKey: batch.sessionKey,
      turnIds: batch.turnIds,
      turnCount: batch.turnCount,
      reason: batch.reason,
      status: "started",
    },
  });
  let sourceSegmentStats: SourceSegmentSemanticExtractionStats;
  try {
    sourceSegmentStats = await runSourceSegmentSemanticExtraction(store, ctx, {
      sessionKey: batch.sessionKey,
      turnIds: batch.turnIds,
    });
    store.auditRepo.finishMaintenance({
      runId: sourceSegmentRunId,
      agentId: ctx.agentId,
      jobType: "source-segment-semantic-extraction",
      startedAt: sourceSegmentStartedAt,
      completedAt: nowIso(),
      status: "completed",
      statsJson: {
        ...sourceSegmentStats,
        sessionKey: batch.sessionKey,
        turnIds: batch.turnIds,
        turnCount: batch.turnCount,
        reason: batch.reason,
      },
    });
  } catch (error) {
    store.auditRepo.finishMaintenance({
      runId: sourceSegmentRunId,
      agentId: ctx.agentId,
      jobType: "source-segment-semantic-extraction",
      startedAt: sourceSegmentStartedAt,
      completedAt: nowIso(),
      status: "failed",
      statsJson: {
        sessionKey: batch.sessionKey,
        turnIds: batch.turnIds,
        turnCount: batch.turnCount,
        reason: batch.reason,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
  const consolidationStats = await runConsolidation(store, ctx, { batch });
  const deltaTriggered =
    sourceSegmentStats.candidatesWritten > 0 ||
    (consolidationStats.batch?.delta.eventsConsidered ?? 0) > 0 ||
    (consolidationStats.batch?.delta.tasksConsidered ?? 0) > 0 ||
    consolidationStats.promotedFacts > 0 ||
    consolidationStats.promotedEdges > 0 ||
    consolidationStats.promotedStates > 0 ||
    consolidationStats.beliefSignalsProcessed > 0 ||
    consolidationStats.beliefsNeedingReevaluation > 0 ||
    consolidationStats.beliefsUpserted > 0 ||
    consolidationStats.semanticUpgrade.taskSummariesUpgraded > 0;

  const abstractionStats = await runAbstractionJobs(store, ctx, {
    refineWithLlm: false,
    batch,
    deltaTriggered,
  });
  runAbstractionPromotion(store, ctx, {
    batch,
    candidateIds: abstractionStats.materializedCandidateIds ?? [],
    deltaTriggered,
  });
}
