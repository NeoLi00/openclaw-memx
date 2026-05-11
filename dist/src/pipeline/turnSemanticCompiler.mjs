import { truncateText } from "../support.mjs";
import { recordMemoryLlmBudgetCall } from "./llmBudgetAudit.mjs";
import { analyzeSemanticHints } from "./semantics.mjs";
import { summarizeTaskHeuristically } from "./taskSummary.mjs";
import { buildDeterministicTaskProposal } from "./taskJudge.mjs";
//#region src/pipeline/turnSemanticCompiler.ts
const TURN_SEMANTIC_COMPILER_CUTOVER_CRITERIA = {
	invariantRegressionMustBeZero: true,
	questionLikeRegressionMustBeZero: true,
	correctionMaterializationRegressionMustBeZero: true,
	fallbackRateMax: .1,
	maxWriteDiffRate: .15
};
const STRATEGY_PROCEDURE_PATTERN = /(?:先.+再|先检查|再检查|然后|最后|回头|优先|步骤|顺序|流程|策略|原则|排查|验证过|记着|最近版本记着|最近两次)/iu;
function sourceRefForMessage(message) {
	return message.sourceRef || `${message.role}:${message.turnId}`;
}
function compileStage(messages) {
	return messages.some((message) => message.role === "user" || message.role === "tool") ? "write_hot_path" : "post_answer_writeback";
}
function familyHintsFromStructuredHints(text, structuredHints) {
	const families = /* @__PURE__ */ new Set();
	const relationConfidence = Math.max(structuredHints?.relation?.confidence ?? 0, ...structuredHints?.relations?.map((entry) => entry.confidence ?? 0) ?? [0]);
	if (structuredHints?.workflow || structuredHints?.workflows && structuredHints.workflows.length > 0) families.add("workflow");
	if (structuredHints?.preference) families.add("preference");
	if (!structuredHints?.correction && relationConfidence >= .82 && !STRATEGY_PROCEDURE_PATTERN.test(text) && (structuredHints?.relation || structuredHints?.relations && structuredHints.relations.length > 0)) families.add("relation_like");
	if (structuredHints?.decision && (structuredHints.timeHints?.length ?? 0) === 0 && text.length <= 140) families.add("fact_like");
	if (STRATEGY_PROCEDURE_PATTERN.test(text) && !structuredHints?.relation && !(structuredHints?.relations && structuredHints.relations.length > 0)) families.add("strategy_like");
	if (structuredHints?.correction) families.add(structuredHints.correction.timeframe === "historical" || structuredHints.correction.timeframe === "compare" ? "event_like" : "fact_like");
	return [...families];
}
function timeframeHint(correction) {
	if (!correction) return "timeless";
	return correction.timeframe;
}
function deterministicCompile(params) {
	const { messages } = params;
	const sourceRefs = messages.map((message) => sourceRefForMessage(message));
	const chunkDrafts = messages.map((message) => ({
		sourceRef: sourceRefForMessage(message),
		summary: truncateText(message.content.trim().replace(/\s+/g, " "), 180),
		lineage: {
			sourceKind: "chunk",
			sourceId: message.turnId,
			sourceRef: sourceRefForMessage(message)
		}
	}));
	const assertionDrafts = [];
	const correctionDrafts = [];
	const relationDrafts = [];
	const supportSpans = [];
	for (const message of messages) {
		const sourceRef = sourceRefForMessage(message);
		const hints = analyzeSemanticHints(message.content);
		const structuredHints = {
			entities: hints.entities,
			timeHints: hints.timeHints,
			...hints.preference ? {
				preference: hints.preference,
				preferenceHint: true
			} : {},
			...hints.workflow ? {
				workflow: hints.workflow,
				workflows: hints.workflows,
				taskStateHint: true
			} : {},
			...hints.relation ? {
				relation: hints.relation,
				relations: hints.relations,
				relationHint: true
			} : {},
			...hints.decision ? {
				decision: hints.decision,
				decisionHint: true
			} : {},
			...hints.correction ? {
				correction: hints.correction,
				correctionHint: true
			} : {}
		};
		const families = familyHintsFromStructuredHints(message.content, structuredHints);
		for (const family of families) assertionDrafts.push({
			draftId: `${sourceRef}:${family}:${assertionDrafts.length}`,
			sourceRef,
			familyHint: family,
			timeframeHint: timeframeHint(structuredHints.correction),
			entityHints: structuredHints.entities,
			slotHints: structuredHints.workflow?.key ? [structuredHints.workflow.key] : void 0,
			supportSpans: [{ text: truncateText(message.content.trim(), 240) }],
			confidence: .7,
			lineage: {
				sourceKind: "chunk",
				sourceId: message.turnId,
				sourceRef
			}
		});
		for (const relation of structuredHints.relations ?? []) relationDrafts.push({
			sourceRef,
			relation: {
				...relation,
				sourceRef: relation.sourceRef ?? sourceRef
			},
			supportSpans: [{ text: truncateText(message.content.trim(), 240) }],
			confidence: relation.confidence ?? .72,
			lineage: {
				sourceKind: "chunk",
				sourceId: message.turnId,
				sourceRef
			}
		});
		if (structuredHints.correction) correctionDrafts.push({
			sourceRef,
			correction: structuredHints.correction,
			supportSpans: [{ text: truncateText(message.content.trim(), 240) }],
			confidence: structuredHints.correction.confidence ?? .72,
			lineage: {
				sourceKind: "chunk",
				sourceId: message.turnId,
				sourceRef
			}
		});
		supportSpans.push({
			sourceRef,
			text: truncateText(message.content.trim(), 240)
		});
	}
	const deterministicTaskSummary = summarizeTaskHeuristically(messages.map((message, index) => ({
		chunkId: `${message.turnId}:${index}`,
		agentId: params.ctx.agentId,
		scope: message.scope,
		sessionKey: message.sessionKey,
		turnId: message.turnId,
		seq: index,
		role: message.role,
		toolName: message.toolName,
		chunkKind: message.role === "tool" ? "tool_result" : "message",
		content: message.content,
		summary: truncateText(message.content.trim().replace(/\s+/g, " "), 180),
		contentHash: `${message.turnId}:${index}`,
		taskId: params.activeTask?.taskId,
		dedupStatus: "active",
		mergeCount: 0,
		sourceRef: sourceRefForMessage(message),
		createdAt: message.observedAt,
		updatedAt: message.observedAt
	})));
	return {
		sourceRefs,
		chunkDrafts,
		taskProposal: {
			...buildDeterministicTaskProposal({
				activeTask: params.activeTask ?? null,
				activeChunks: params.activeChunks ?? [],
				recentTasks: params.recentTasks ?? [],
				recentChunksByTask: params.recentChunksByTask ?? {},
				newMessages: params.messages,
				ctx: params.ctx
			}),
			...deterministicTaskSummary.summary ? {
				summary: deterministicTaskSummary.summary,
				summaryConfidence: .62
			} : {},
			reason: "deterministic-turn-compile"
		},
		assertionDrafts,
		correctionDrafts,
		relationDrafts,
		resourceAssertions: [],
		adviceSignals: [],
		supportSpans,
		compilerProvenance: {
			source: "deterministic",
			mode: "deterministic",
			reasons: [`criteria=fallback<=${TURN_SEMANTIC_COMPILER_CUTOVER_CRITERIA.fallbackRateMax}`]
		}
	};
}
function normalizeCompilerRelationDrafts(relationDrafts) {
	return (relationDrafts ?? []).map((entry) => {
		const predicate = String(entry.relation.predicate);
		if (predicate !== "owned_by" && predicate !== "blocked_by") return entry;
		return {
			...entry,
			relation: {
				...entry.relation,
				subject: entry.relation.object,
				predicate: predicate === "owned_by" ? "owner_of" : "blocks",
				object: entry.relation.subject,
				rawPredicate: entry.relation.rawPredicate ?? predicate
			}
		};
	});
}
function mergeCompilerFrame(base, patch) {
	return {
		...base,
		...patch,
		sourceRefs: patch.sourceRefs && patch.sourceRefs.length > 0 ? patch.sourceRefs : base.sourceRefs,
		chunkDrafts: patch.chunkDrafts && patch.chunkDrafts.length > 0 ? patch.chunkDrafts : base.chunkDrafts,
		taskProposal: patch.taskProposal ?? base.taskProposal,
		assertionDrafts: patch.assertionDrafts ?? [],
		correctionDrafts: patch.correctionDrafts ?? [],
		relationDrafts: normalizeCompilerRelationDrafts(patch.relationDrafts),
		resourceAssertions: patch.resourceAssertions ?? [],
		adviceSignals: patch.adviceSignals ?? [],
		supportSpans: patch.supportSpans && patch.supportSpans.length > 0 ? patch.supportSpans : base.supportSpans,
		compilerProvenance: patch.compilerProvenance ?? {
			source: "llm",
			mode: "semantic-compiler-authoritative",
			reasons: ["llm-semantic-fields-explicit"]
		}
	};
}
function semanticDraftForSourceRef(frame, sourceRef) {
	const assertionDrafts = frame.assertionDrafts.filter((entry) => entry.sourceRef === sourceRef);
	const correctionDrafts = frame.correctionDrafts.filter((entry) => entry.sourceRef === sourceRef);
	const isTurnPrimarySource = sourceRef === frame.sourceRefs[0];
	const relationDrafts = (frame.relationDrafts ?? []).filter((entry) => entry.sourceRef === sourceRef || isTurnPrimarySource).map((entry) => ({
		...entry,
		relation: {
			...entry.relation,
			sourceRef: entry.relation.sourceRef ?? entry.sourceRef
		}
	}));
	const resourceAssertions = (frame.resourceAssertions ?? []).filter((entry) => entry.sourceRef === sourceRef);
	const adviceSignals = (frame.adviceSignals ?? []).filter((entry) => entry.sourceRefs.includes(sourceRef));
	const supportSpans = frame.supportSpans.filter((entry) => entry.sourceRef === sourceRef);
	if (assertionDrafts.length === 0 && correctionDrafts.length === 0 && relationDrafts.length === 0 && resourceAssertions.length === 0 && adviceSignals.length === 0 && supportSpans.length === 0) return;
	return {
		sourceRef,
		assertionDrafts,
		correctionDrafts,
		relationDrafts,
		resourceAssertions,
		adviceSignals,
		supportSpans,
		taskProposal: frame.taskProposal,
		compilerProvenance: frame.compilerProvenance
	};
}
function affirmedRelationDrafts(draft) {
	return (draft.relationDrafts ?? []).filter((entry) => entry.relation.polarity !== "negated");
}
function primaryFamily(draft) {
	for (const family of [
		"workflow",
		"strategy_like",
		"preference",
		"fact_like",
		"relation_like",
		"event_like"
	]) if (draft.assertionDrafts.some((entry) => entry.familyHint === family)) return family;
	if (affirmedRelationDrafts(draft).length > 0) return "relation_like";
}
function draftMaterializationHint(draft) {
	const primary = primaryFamily(draft);
	const correction = draft.correctionDrafts[0]?.correction;
	const timeframeHint = correction?.timeframe ?? draft.assertionDrafts[0]?.timeframeHint;
	if (!primary && !correction) return;
	const reasons = [];
	if (primary) reasons.push(`primary-family:${primary}`);
	if (correction?.timeframe) reasons.push(`correction-timeframe:${correction.timeframe}`);
	return {
		sourceRef: draft.sourceRef,
		...primary ? { primaryFamily: primary } : {},
		...timeframeHint ? { timeframeHint } : {},
		...primary === "strategy_like" ? { preferGuidanceFact: true } : {},
		...primary === "event_like" || correction?.timeframe === "historical" || correction?.timeframe === "compare" ? { preferEvent: true } : {},
		...correction?.targetKind === "fact" && correction.priorValue && correction.nextValue ? { replacementMode: "supersede_fact" } : {},
		reasons
	};
}
function frameHintsForSourceRef(frame, sourceRef) {
	if (!frame) return;
	const semanticDraft = semanticDraftForSourceRef(frame, sourceRef);
	if (!semanticDraft) return;
	const correction = semanticDraft.correctionDrafts[0]?.correction;
	const relevantDrafts = semanticDraft.assertionDrafts;
	const relationDrafts = affirmedRelationDrafts(semanticDraft);
	const semanticFamilies = [...new Set(relevantDrafts.map((entry) => entry.familyHint))];
	if (relationDrafts.length > 0 && !semanticFamilies.includes("relation_like")) semanticFamilies.push("relation_like");
	const semanticTimeframes = [...new Set(relevantDrafts.map((entry) => entry.timeframeHint))];
	const slotHints = [...new Set(relevantDrafts.flatMap((entry) => Array.isArray(entry.slotHints) ? entry.slotHints.filter(Boolean) : []))];
	const entityHints = relevantDrafts.flatMap((entry) => entry.entityHints ?? []);
	return {
		...relevantDrafts.some((entry) => entry.familyHint === "workflow") ? { taskStateHint: true } : {},
		...relevantDrafts.some((entry) => entry.familyHint === "preference") ? { preferenceHint: true } : {},
		...relevantDrafts.some((entry) => entry.familyHint === "relation_like") ? { relationHint: true } : {},
		...relationDrafts.length > 0 ? {
			relationHint: true,
			relation: relationDrafts[0]?.relation,
			relations: relationDrafts.map((entry) => entry.relation)
		} : {},
		...correction ? {
			correctionHint: true,
			correction
		} : {},
		...semanticFamilies.length > 0 ? { semanticFamilies } : {},
		...semanticTimeframes.length > 0 ? { semanticTimeframes } : {},
		...slotHints.length > 0 ? { slotHints } : {},
		...entityHints.length > 0 ? { entities: entityHints } : {},
		...(semanticDraft.resourceAssertions?.length ?? 0) > 0 ? { resourceAssertions: semanticDraft.resourceAssertions } : {},
		...(semanticDraft.adviceSignals?.length ?? 0) > 0 ? { adviceSignals: semanticDraft.adviceSignals } : {},
		semanticDraft,
		materializationHint: draftMaterializationHint(semanticDraft)
	};
}
async function compileTurnSemantics(params) {
	const stage = compileStage(params.messages);
	if (!params.ctx.config.advanced.enableTurnSemanticCompiler) return;
	const fallback = deterministicCompile(params);
	if (!params.reasoner?.isEnabled?.() || !params.reasoner.compileTurnSemantics) {
		recordMemoryLlmBudgetCall(params.ctx.llmBudgetAudit, {
			label: "turn-semantic-compile",
			stage,
			provenance: "deterministic",
			mode: "deterministic",
			detail: "turnSemanticCompiler stayed on the deterministic path"
		});
		return fallback;
	}
	const compiled = await params.reasoner.compileTurnSemantics(params.messages, fallback, {
		stage,
		audit: params.ctx.llmBudgetAudit
	});
	if (!compiled) return {
		...fallback,
		compilerProvenance: {
			source: "hybrid",
			mode: "fallback",
			reasons: ["turn-compile-fallback"]
		}
	};
	return mergeCompilerFrame(fallback, compiled);
}
//#endregion
export { compileTurnSemantics, frameHintsForSourceRef };
