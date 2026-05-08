import type { MemxStoreBundle } from "../runtime.js";
import type { MaintenanceBatchMetadata, MemoryOperationContext } from "../types.js";
import { runAbstractionJobs } from "./abstractionJobs.js";
import { runAbstractionPromotion } from "./abstractionPromotion.js";
import { runConsolidation } from "./consolidate.js";

export async function runAutomaticMaintenanceBatch(
  store: MemxStoreBundle,
  ctx: MemoryOperationContext,
  batch: MaintenanceBatchMetadata,
): Promise<void> {
  const consolidationStats = await runConsolidation(store, ctx, { batch });
  const deltaTriggered =
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
