import { runAbstractionJobs } from "./abstractionJobs.mjs";
import { runAbstractionPromotion } from "./abstractionPromotion.mjs";
import { runConsolidation } from "./consolidate.mjs";
//#region src/pipeline/maintenanceBatch.ts
async function runAutomaticMaintenanceBatch(store, ctx, batch) {
	const consolidationStats = await runConsolidation(store, ctx, { batch });
	const deltaTriggered = (consolidationStats.batch?.delta.eventsConsidered ?? 0) > 0 || (consolidationStats.batch?.delta.tasksConsidered ?? 0) > 0 || consolidationStats.promotedFacts > 0 || consolidationStats.promotedEdges > 0 || consolidationStats.promotedStates > 0 || consolidationStats.beliefSignalsProcessed > 0 || consolidationStats.beliefsNeedingReevaluation > 0 || consolidationStats.beliefsUpserted > 0 || consolidationStats.semanticUpgrade.taskSummariesUpgraded > 0;
	runAbstractionPromotion(store, ctx, {
		batch,
		candidateIds: (await runAbstractionJobs(store, ctx, {
			refineWithLlm: false,
			batch,
			deltaTriggered
		})).materializedCandidateIds ?? [],
		deltaTriggered
	});
}
//#endregion
export { runAutomaticMaintenanceBatch };
