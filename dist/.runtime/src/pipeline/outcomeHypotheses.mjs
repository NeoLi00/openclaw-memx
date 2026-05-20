import { clamp01, normalizeText, stableHash } from "../support.mjs";
//#region src/pipeline/outcomeHypotheses.ts
function stringValue(value) {
	return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function booleanValue(value) {
	return value === true;
}
function stageValue(value) {
	return value === "candidate" || value === "probationary" || value === "active" || value === "decaying" || value === "quarantined" || value === "superseded" ? value : void 0;
}
function isAuthoritativeOutcomeResolutionMetadata(metadata) {
	if (!metadata) return false;
	const stage = stageValue(metadata.candidateOutcomeHypothesisStage ?? metadata.stage ?? metadata.candidateStage);
	const hasUserEvidence = booleanValue(metadata.candidateOutcomeHasUserEvidence ?? metadata.hasUserEvidence);
	const hasToolEvidence = booleanValue(metadata.candidateOutcomeHasToolEvidence ?? metadata.hasToolEvidence);
	const hasNonAssistantGrounding = booleanValue(metadata.candidateOutcomeHasNonAssistantGrounding ?? metadata.hasNonAssistantGrounding ?? (hasUserEvidence || hasToolEvidence));
	const judgeShouldPromote = booleanValue(metadata.candidateOutcomeJudgeShouldPromote ?? metadata.judgeShouldPromote);
	const phase = stringValue(metadata.candidateResolutionPhase ?? metadata.phase);
	return hasNonAssistantGrounding && (judgeShouldPromote || phase === "validated" || phase === "resolved" || stage === "probationary" || stage === "active");
}
function collectOutcomeEvidenceStats(chunks) {
	const assistantCount = chunks.filter((chunk) => chunk.role === "assistant").length;
	const userCount = chunks.filter((chunk) => chunk.role === "user").length;
	const toolCount = chunks.filter((chunk) => chunk.role === "tool").length;
	return {
		assistantCount,
		userCount,
		toolCount,
		hasUserEvidence: userCount > 0,
		hasToolEvidence: toolCount > 0,
		hasNonAssistantGrounding: userCount > 0 || toolCount > 0
	};
}
function inferOutcomeHypothesisStage(params) {
	const strongPhase = params.outcome.phase === "validated" || params.outcome.phase === "resolved";
	const probationaryScore = clamp01(params.decision.promotionScore * .42 + params.outcome.verificationScore * .22 + params.outcome.closureScore * .18 + (params.evidence.hasToolEvidence ? .12 : params.evidence.hasUserEvidence ? .08 : 0) + (strongPhase ? .12 : .04) - params.outcome.contradictionRisk * .26);
	if (params.evidence.hasNonAssistantGrounding && strongPhase && (params.decision.shouldPromote || probationaryScore >= .72) && params.outcome.contradictionRisk <= .34) return "probationary";
	return "candidate";
}
function buildOutcomeEventCandidate(task, proposal, observedAt) {
	return {
		candidateId: stableHash([
			task.taskId,
			proposal.outcomeKey,
			observedAt,
			"outcome-event"
		]),
		source: {
			kind: "assistant",
			sessionKey: task.sessionKey,
			messageId: task.taskId
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
			taskStateHint: true
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
			promotionScore: proposal.promotionScore
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
			captureAuthorized: true
		},
		classification: "episodic-event",
		confidence: proposal.confidence
	};
}
function buildOutcomeHypothesisCandidate(params) {
	const evidence = collectOutcomeEvidenceStats(params.evidenceChunks);
	const stage = inferOutcomeHypothesisStage({
		outcome: params.outcome,
		decision: params.decision,
		evidence
	});
	const confidence = clamp01(params.outcome.confidence * .32 + params.decision.promotionScore * .28 + params.outcome.verificationScore * .16 + params.outcome.closureScore * .12 + (evidence.hasToolEvidence ? .12 : evidence.hasUserEvidence ? .08 : .03) - params.outcome.contradictionRisk * .16);
	const usefulnessScore = clamp01(params.decision.promotionScore * .34 + params.outcome.verificationScore * .28 + params.outcome.closureScore * .12 + (evidence.hasNonAssistantGrounding ? .16 : .04) + (evidence.hasToolEvidence ? .1 : 0));
	const stabilityScore = clamp01(params.outcome.confidence * .24 + params.outcome.closureScore * .18 + params.outcome.verificationScore * .18 + (evidence.hasNonAssistantGrounding ? .2 : .05) + (params.outcome.phase === "validated" || params.outcome.phase === "resolved" ? .14 : .06) + (params.decision.shouldPromote ? .06 : 0));
	const contradictionScore = clamp01(params.outcome.contradictionRisk * .88 + (evidence.hasNonAssistantGrounding ? 0 : .06));
	const metadata = {
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
		frameworkRound: 5
	};
	return {
		candidateId: stableHash([
			params.task.taskId,
			params.outcome.outcomeKey,
			"outcome_hypothesis"
		]),
		agentId: params.agentId,
		scope: params.task.scope,
		abstractionType: "outcome_hypothesis",
		semanticKey: `outcome_hypothesis:${params.task.scope}:${params.task.taskId}:${params.outcome.outcomeKey}`,
		summary: params.outcome.summary,
		supportContentRefs: [`task:${params.task.taskId}`, ...params.outcome.evidenceChunkIds.map((chunkId) => `chunk:${chunkId}`)],
		supportBeliefIds: [],
		confidence,
		usefulnessScore,
		stabilityScore,
		contradictionScore,
		stage,
		metadataJson: metadata,
		createdAt: params.observedAt,
		updatedAt: params.observedAt
	};
}
//#endregion
export { buildOutcomeEventCandidate, buildOutcomeHypothesisCandidate, isAuthoritativeOutcomeResolutionMetadata };
