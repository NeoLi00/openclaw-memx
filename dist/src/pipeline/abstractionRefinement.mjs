import { truncateText } from "../support.mjs";
//#region src/pipeline/abstractionRefinement.ts
function supportsSuggestedDisplayName(candidate) {
	return candidate.abstractionType === "concept_candidate" || candidate.abstractionType === "graph_hypothesis" || candidate.abstractionType === "outcome_hypothesis";
}
function eligibleForLlmRefinement(candidate) {
	if (candidate.stage === "quarantined" || candidate.abstractionType === "derived_state") return false;
	if (candidate.confidence < .64 || candidate.usefulnessScore < .52 || candidate.stabilityScore < .54) return false;
	return candidate.abstractionType === "concept_candidate" || candidate.abstractionType === "workflow_pattern" || candidate.abstractionType === "graph_hypothesis" || candidate.abstractionType === "outcome_hypothesis";
}
function applyAbstractionRefinement(params) {
	const { candidate, result, now, resolvedModel } = params;
	const nextSummary = typeof result.summary === "string" && result.summary.trim() ? truncateText(result.summary.trim(), 220) : candidate.summary;
	const nextStage = result.stage ?? candidate.stage;
	const suggestedDisplayName = supportsSuggestedDisplayName(candidate) && typeof result.displayName === "string" && result.displayName.trim() ? truncateText(result.displayName.trim(), 80) : void 0;
	const summaryChanged = nextSummary !== candidate.summary;
	const stageChanged = nextStage !== candidate.stage;
	const displayNameChanged = suggestedDisplayName !== void 0 && suggestedDisplayName !== candidate.metadataJson.suggestedDisplayName;
	if (!summaryChanged && !stageChanged && !displayNameChanged) return null;
	return {
		...candidate,
		summary: nextSummary,
		stage: nextStage,
		metadataJson: {
			...candidate.metadataJson,
			...suggestedDisplayName ? { suggestedDisplayName } : {},
			llmRefinement: {
				provider: resolvedModel?.provider ?? null,
				model: resolvedModel?.model ?? null,
				refinedAt: now,
				reason: result.reason ?? "llm abstraction refinement",
				originalSummary: candidate.summary,
				originalStage: candidate.stage,
				summaryChanged,
				stageChanged,
				...suggestedDisplayName ? { suggestedDisplayName } : {},
				frameworkRound: 6
			}
		},
		updatedAt: now
	};
}
//#endregion
export { applyAbstractionRefinement, eligibleForLlmRefinement };
