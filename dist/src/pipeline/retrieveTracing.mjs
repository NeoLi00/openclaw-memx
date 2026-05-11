import "../support.mjs";
import { seedEntityNamesFromQuery } from "./semantic/heuristics.mjs";
import { semanticTextSimilarity } from "./semantic/textSimilarity.mjs";
import "./semantics.mjs";
//#region src/pipeline/retrieveTracing.ts
function summarizeBackgroundRecallBundle(bundle) {
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
			charCount: block.lines.join("\n").length
		}))
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
	"用户偏好"
]);
function sanitizeFocusedRecallQuery(rawQuery, focusedQuery) {
	const raw = rawQuery.trim();
	const focused = focusedQuery?.trim();
	if (!focused) return raw;
	const normalizedFocused = focused.toLowerCase().replace(/\s+/g, " ");
	if (GENERIC_RECALL_QUERIES.has(normalizedFocused)) return raw;
	const rawEntitySeeds = new Set(seedEntityNamesFromQuery(raw).map((entry) => entry.toLowerCase()));
	const focusedEntitySeeds = new Set(seedEntityNamesFromQuery(focused).map((entry) => entry.toLowerCase()));
	if (rawEntitySeeds.size >= 2 && focusedEntitySeeds.size === 0) return raw;
	if (semanticTextSimilarity(raw, focused) < .18 && focused.length < raw.length * .7) return raw;
	return focused;
}
function buildRecallAuditPayload(options = {}) {
	if (!options.plan && !options.probe && !options.background && !options.selectionTrace && !options.recallMode && !options.fullRecallTrigger) return;
	return {
		mode: options.recallMode ?? "full",
		fullRecallTrigger: options.fullRecallTrigger,
		plan: options.plan ? {
			shouldRecall: options.plan.shouldRecall,
			focusedQuery: options.plan.focusedQuery,
			reason: options.plan.reason,
			routeHint: options.plan.routeHint,
			judgmentMode: options.plan.judgmentMode
		} : void 0,
		probe: options.probe ? {
			shouldEscalate: options.probe.shouldEscalate,
			probeScore: options.probe.probeScore,
			hintedRoute: options.probe.hintedRoute,
			focusedQuery: options.probe.focusedQuery,
			reasons: options.probe.reasons,
			signals: options.probe.signals,
			thresholds: options.probe.thresholds
		} : void 0,
		controller: options.controller ? {
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
			signals: options.controller.signals
		} : void 0,
		shallow: options.shallow ? {
			searchQuery: options.shallow.searchQuery,
			routeHint: options.shallow.routeHint,
			topSupport: options.shallow.topSupport,
			hybridHitCount: options.shallow.hybridHitCount,
			projectionRoles: options.shallow.projectionRoles,
			reasons: options.shallow.reasons,
			routeSummaries: Object.fromEntries(Object.entries(options.shallow.routeSummaries).map(([routeType, summary]) => [routeType, {
				support: summary.support,
				candidateCount: summary.candidateCount,
				projectionSupport: summary.projectionSupport,
				freshness: summary.freshness,
				contradictionPressure: summary.contradictionPressure,
				grounding: summary.grounding,
				topKind: summary.topKind,
				topObjectId: summary.topObjectId
			}]))
		} : void 0,
		qualityGate: options.qualityGate ? {
			decision: options.qualityGate.decision,
			routeHint: options.qualityGate.routeHint,
			focusedQuery: options.qualityGate.focusedQuery,
			confidence: options.qualityGate.confidence,
			reasons: options.qualityGate.reasons,
			metrics: options.qualityGate.metrics
		} : void 0,
		background: options.background ? summarizeBackgroundRecallBundle(options.background) : void 0,
		queryAnalysis: options.queryAnalysis ? {
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
			compilerProvenance: options.queryAnalysis.compilerProvenance
		} : void 0,
		budgetPlan: options.budgetPlan ? {
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
				candidateCount: entry.candidateCount
			})),
			objectiveBudgets: Object.fromEntries(Object.entries(options.budgetPlan.objectiveBudgets).map(([routeType, budget]) => [routeType, {
				weight: budget.weight,
				rawScore: budget.rawScore,
				activated: budget.activated,
				objectBudget: budget.objectBudget,
				promptChars: budget.promptChars,
				minObjects: budget.minObjects,
				minPromptChars: budget.minPromptChars
			}]))
		} : void 0,
		selectionTrace: options.selectionTrace ? {
			candidateCountsByRoute: options.selectionTrace.candidateCountsByRoute,
			reserveSelections: Object.fromEntries(Object.entries(options.selectionTrace.reserveSelections).map(([routeType, entries]) => [routeType, entries.map((entry) => ({
				objectId: entry.objectId,
				kind: entry.kind,
				weightedScore: entry.weightedScore,
				strongestRoute: entry.strongestRoute,
				selectionReason: entry.selectionReason
			}))])),
			overflowSelections: options.selectionTrace.overflowSelections.map((entry) => ({
				objectId: entry.objectId,
				kind: entry.kind,
				weightedScore: entry.weightedScore,
				strongestRoute: entry.strongestRoute,
				selectionReason: entry.selectionReason
			})),
			droppedHighScore: options.selectionTrace.droppedHighScore.map((entry) => ({
				objectId: entry.objectId,
				kind: entry.kind,
				weightedScore: entry.weightedScore,
				strongestRoute: entry.strongestRoute,
				selectionReason: entry.selectionReason
			}))
		} : void 0
	};
}
function compareEvidenceRowsChronologically(left, right) {
	if (!left.observedAt && !right.observedAt) return left.text.localeCompare(right.text) || left.id.localeCompare(right.id);
	if (!left.observedAt) return 1;
	if (!right.observedAt) return -1;
	const observedDelta = left.observedAt.localeCompare(right.observedAt);
	if (observedDelta !== 0) return observedDelta;
	const textDelta = left.text.localeCompare(right.text);
	if (textDelta !== 0) return textDelta;
	return left.id.localeCompare(right.id);
}
//#endregion
export { buildRecallAuditPayload, compareEvidenceRowsChronologically, sanitizeFocusedRecallQuery, summarizeBackgroundRecallBundle };
