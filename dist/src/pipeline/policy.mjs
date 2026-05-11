import { clamp01, normalizeText, normalizedTerms } from "../support.mjs";
import { hasExplicitRememberIntent, isLowValueChatter, isQuestionLike } from "./semantic/heuristics.mjs";
import { inferWriteLlmStage, recordMemoryLlmBudgetCall } from "./llmBudgetAudit.mjs";
import { containsLikelySecret, looksLikePromptInjection } from "../security/injection.mjs";
import { analyzeSemanticHints, canonicalizePreferenceHint } from "./semantics.mjs";
import { sanitizeWorkflowHint } from "./authority.mjs";
import { containsSensitiveValue, sensitivityScore } from "../security/pii.mjs";
import { DEFAULT_SCORES, EPISODIC_MIN_SALIENCE_FALLBACK, REPETITION_BOOST_LOG_SCALE, REPETITION_BOOST_MAX, SALIENCE_BASE, SALIENCE_DECISION_HINT, SALIENCE_EXPLICIT_INTENT, SALIENCE_EXTRA_RELATION, SALIENCE_IMPORTANT_EVENT, SALIENCE_LOW_VALUE_PENALTY, SALIENCE_PREFERENCE, SALIENCE_PREFERENCE_HINT, SALIENCE_RELATION_HINT, SALIENCE_SHORT_TEXT_PENALTY, SALIENCE_STABLE_FACT, SALIENCE_TEMPORAL_PATTERN, SALIENCE_TOOL_SOURCE, SALIENCE_WORKFLOW, SALIENCE_WORKFLOW_HINT, SALIENCE_WORKFLOW_PATTERN, SENSITIVITY_PROMPT_INJECTION_BOOST, SENSITIVITY_SENSITIVE_VALUE_BOOST, STABILITY_BASE, STABILITY_PREFERENCE, STABILITY_PROFILE_OR_PREFERENCE, STABILITY_RELATION_HINT, STABILITY_TEMPORAL_PENALTY, STABILITY_TOOL_PENALTY, STABILITY_WORKFLOW, STABILITY_WORKFLOW_PATTERN, UTILITY_BASE, UTILITY_DECISION_HINT, UTILITY_FACT_OR_RELATION, UTILITY_IMPORTANT_EVENT, UTILITY_PREFERENCE, UTILITY_PREFERENCE_HINT, UTILITY_RELATION_HINT, UTILITY_TEMPORAL_PATTERN, UTILITY_TOOL_SOURCE, UTILITY_WORKFLOW, UTILITY_WORKFLOW_HINT } from "./constants.mjs";
import { containsUntrustedBanner } from "../security/escaping.mjs";
//#region src/pipeline/policy.ts
const STABLE_FACT_PATTERN = /\b(?:i prefer|i like|i dislike|my name is|i live in|i work at|constraint|must use|always use|never use)\b|(?:我偏好|我喜欢|我不喜欢|我叫|我住在|我在.*工作|约束|必须用|以后都用|默认用)/iu;
const PROFILE_PATTERN = /\b(?:my name is|i live in|i work at|my timezone is|my pronouns are)\b|(?:我叫|我住在|我在.*工作|我的时区是|我的代词是)/iu;
const WORKFLOW_PATTERN = /\b(?:working on|next step|current task|active project|progress|todo|blocked on|on hold|suspend)\b|(?:现在先|我在做|我要做|当前任务|当前项目|下一步|后面再|后面还要|后面要|后续要|卡点|卡在|搁置|暂停|blocker)/iu;
const TEMPORAL_PATTERN = /\b(?:today|yesterday|last|failed|succeeded|ran|deployed|fixed|later|discovered|disproved|verified|corrected)\b|(?:今天|昨天|上周|最近|失败|成功|修复|后来|后面|最后|发现|推导|验证|推翻)/iu;
const IMPORTANT_EVENT_PATTERN = /\b(?:failed|failure|error|timeout|succeeded|success|fixed|resolved|deployed|milestone|attended|participated|visited|joined|enrolled|graduated|completed|finished|started|launched|discovered|disproved|verified|corrected|counterexample)\b|(?:失败|错误|超时|成功|修复|解决|部署|里程碑|参加|出席|参与|加入|报名|完成|开始|结束|发现|验证|推翻|修正|反例|漏掉|对上|推导)/iu;
const HYPOTHETICAL_REFERENCE_RULE_PATTERN = /(?:如果我(?:突然)?(?:问|说)|如果之后我(?:问|说)|当我(?:说|问)|以后我(?:说|问)).{0,80}(?:应该知道|应该带上|需要带上|得能接上|你应该|要能关联)/iu;
const TASK_BOUNDARY_PATTERN = /\b(?:switch(?:ing)? to|move to|different project|another project|new topic)\b|(?:切到|换到|改做|先做另一个项目|换个项目|切换到)/iu;
function isHypotheticalReferenceRule(text) {
	return HYPOTHETICAL_REFERENCE_RULE_PATTERN.test(text);
}
function structuredRelations(candidate) {
	const hints = candidate.structuredHints;
	const relations = hints?.relations && hints.relations.length > 0 ? hints.relations : hints?.relation ? [hints.relation] : void 0;
	if (!relations) return;
	const affirmed = relations.filter((relation) => relation.polarity !== "negated");
	if (affirmed.length === 0) return;
	return affirmed;
}
function repetitionBoost(candidate) {
	const mentions = Number(candidate.metadata?.mentionCount ?? 1);
	if (mentions <= 1) return 0;
	return Math.min(REPETITION_BOOST_MAX, Math.log1p(mentions - 1) * REPETITION_BOOST_LOG_SCALE);
}
function derivePolicySignals(candidate, mode = "heuristic") {
	const text = candidate.rawText;
	const explicitIntent = hasExplicitRememberIntent(text);
	const questionLikeUserQuery = candidate.source.kind === "user" && (isQuestionLike(text) || isHypotheticalReferenceRule(text)) && !explicitIntent;
	const cached = candidate.structuredHints;
	const hasBaseArrays = cached && Array.isArray(cached.entities) && Array.isArray(cached.timeHints);
	const hasAnySignalObject = cached?.preference || cached?.workflow || cached?.workflows && cached.workflows.length > 0 || cached?.relation || cached?.relations && cached.relations.length > 0 || cached?.decision;
	const analyzed = mode === "heuristic" && !(hasBaseArrays && hasAnySignalObject) ? analyzeSemanticHints(text) : null;
	const preference = canonicalizePreferenceHint(cached?.preference) ?? canonicalizePreferenceHint(analyzed?.preference);
	const workflows = cached?.workflows && cached.workflows.length > 0 ? cached.workflows : cached?.workflow ? [cached.workflow] : analyzed?.workflows ?? [];
	const effectiveWorkflows = questionLikeUserQuery ? [] : workflows;
	const relations = structuredRelations(candidate) ?? (analyzed?.relation ? [analyzed.relation] : []);
	const relation = relations[0];
	const decision = cached?.decision ?? analyzed?.decision;
	return {
		preference,
		workflow: effectiveWorkflows[0],
		workflows: effectiveWorkflows,
		relations,
		relation,
		decision,
		preferenceHint: Boolean(preference),
		workflowHint: effectiveWorkflows.length > 0,
		relationHint: relations.length > 0,
		decisionHint: Boolean(decision)
	};
}
function enrichCandidateWithSignals(candidate, signals) {
	return {
		...candidate,
		structuredHints: {
			...candidate.structuredHints ?? {},
			preferenceHint: signals.preferenceHint,
			decisionHint: signals.decisionHint,
			relationHint: signals.relationHint,
			taskStateHint: signals.workflowHint,
			preference: signals.preference ?? void 0,
			workflow: signals.workflow ?? void 0,
			workflows: signals.workflows.length > 0 ? signals.workflows : void 0,
			relation: signals.relation ?? void 0,
			relations: signals.relations.length > 0 ? signals.relations : void 0,
			decision: signals.decision ?? void 0
		}
	};
}
function enrichCandidateWithLlmJudgment(candidate, judgment) {
	const explicitIntent = hasExplicitRememberIntent(candidate.rawText);
	const suppressWorkflowHints = candidate.source.kind === "user" && (isQuestionLike(candidate.rawText) || isHypotheticalReferenceRule(candidate.rawText)) && !explicitIntent;
	const existingPreference = canonicalizePreferenceHint(candidate.structuredHints?.preference);
	const llmPreference = canonicalizePreferenceHint(judgment.preference);
	const existingWorkflows = candidate.structuredHints?.workflows && candidate.structuredHints.workflows.length > 0 ? candidate.structuredHints.workflows : candidate.structuredHints?.workflow ? [candidate.structuredHints.workflow] : [];
	const llmWorkflows = judgment.workflows && judgment.workflows.length > 0 ? judgment.workflows : judgment.workflow ? [judgment.workflow] : [];
	const workflows = suppressWorkflowHints ? [] : mergeWorkflowHints(existingWorkflows, llmWorkflows);
	const relations = mergeRelationHints(structuredRelations(candidate) ?? [], judgment.relations && judgment.relations.length > 0 ? judgment.relations : judgment.relation ? [judgment.relation] : []);
	return {
		...candidate,
		structuredHints: {
			...candidate.structuredHints ?? {},
			preferenceHint: Boolean(llmPreference ?? existingPreference),
			decisionHint: Boolean(judgment.decision ?? candidate.structuredHints?.decision),
			relationHint: relations.length > 0,
			taskStateHint: workflows.length > 0,
			preference: llmPreference ?? existingPreference ?? void 0,
			workflow: workflows[0] ?? void 0,
			workflows: workflows.length > 0 ? workflows : void 0,
			relation: relations[0] ?? void 0,
			relations: relations.length > 0 ? relations : void 0,
			decision: judgment.decision ?? candidate.structuredHints?.decision ?? void 0
		}
	};
}
function mergeWorkflowHints(existing, llm) {
	const byKey = /* @__PURE__ */ new Map();
	for (const workflow of existing) {
		const sanitized = sanitizeWorkflowHint(workflow);
		if (sanitized) byKey.set(sanitized.key, sanitized);
	}
	for (const workflow of llm) {
		const sanitized = sanitizeWorkflowHint(workflow);
		if (!sanitized) continue;
		const current = byKey.get(sanitized.key);
		if (!current) {
			byKey.set(sanitized.key, sanitized);
			continue;
		}
		byKey.set(sanitized.key, {
			...current,
			...sanitized,
			value: {
				...current.value ?? {},
				...sanitized.value ?? {}
			},
			confidence: Math.max(current.confidence ?? 0, sanitized.confidence ?? 0),
			reason: sanitized.reason || current.reason,
			stateKind: sanitized.stateKind ?? current.stateKind
		});
	}
	return [...byKey.values()];
}
function relationHintKey(relation) {
	return [
		relation.subject,
		relation.predicate,
		relation.polarity ?? "affirmed",
		relation.object,
		relation.relationSlot ?? "",
		relation.rawPredicate ?? ""
	].map((value) => normalizeText(String(value))).join("|");
}
function mergeRelationHints(existing, llm) {
	const byKey = /* @__PURE__ */ new Map();
	for (const relation of existing) byKey.set(relationHintKey(relation), relation);
	for (const relation of llm) {
		const key = relationHintKey(relation);
		const current = byKey.get(key);
		if (!current) {
			byKey.set(key, relation);
			continue;
		}
		byKey.set(key, {
			...current,
			...relation,
			confidence: Math.max(current.confidence ?? 0, relation.confidence ?? 0),
			reason: relation.reason || current.reason
		});
	}
	return [...byKey.values()];
}
function hasStructuredSemanticSignal(candidate) {
	const hints = candidate.structuredHints;
	return Boolean(hints?.preference || hints?.decision || hints?.workflow || hints?.workflows && hints.workflows.length > 0 || hints?.relation || hints?.relations && hints.relations.length > 0 || hints?.resourceAssertions && hints.resourceAssertions.length > 0 || hints?.adviceSignals && hints.adviceSignals.length > 0);
}
function maxHintConfidence(values) {
	const finite = values.filter((value) => typeof value === "number" && Number.isFinite(value));
	if (finite.length === 0) return;
	return Math.max(...finite);
}
function semanticDraftGateScores(action, hintConfidence) {
	const defaults = defaultScoresForAction(action);
	if (hintConfidence == null) return defaults;
	const confidenceFloor = clamp01(hintConfidence);
	return {
		salienceScore: clamp01(Math.max(defaults.salienceScore - .08, confidenceFloor)),
		expectedFutureUtility: clamp01(Math.max(defaults.expectedFutureUtility - .08, confidenceFloor * .92)),
		stabilityScore: clamp01(Math.max(defaults.stabilityScore - .08, confidenceFloor * .9))
	};
}
function semanticDraft(candidate) {
	return candidate.structuredHints?.semanticDraft;
}
function semanticDraftFamilies(candidate) {
	const draft = semanticDraft(candidate);
	const draftFamilies = draft?.assertionDrafts.map((entry) => entry.familyHint) ?? [];
	if ((draft?.relationDrafts?.length ?? 0) > 0) return [...new Set([...draftFamilies, "relation_like"])];
	if (draftFamilies.length > 0) return [...new Set(draftFamilies)];
	return [...new Set(candidate.structuredHints?.semanticFamilies ?? [])];
}
function semanticDraftTimeframes(candidate) {
	const draftTimeframes = semanticDraft(candidate)?.assertionDrafts.map((entry) => entry.timeframeHint) ?? [];
	if (draftTimeframes.length > 0) return [...new Set(draftTimeframes)];
	return [...new Set(candidate.structuredHints?.semanticTimeframes ?? [])];
}
function semanticDraftMaterializationHint(candidate) {
	return candidate.structuredHints?.materializationHint;
}
function semanticDraftConfidence(candidate) {
	const draft = semanticDraft(candidate);
	return maxHintConfidence([
		maxHintConfidence(draft?.assertionDrafts.map((entry) => entry.confidence).filter((value) => typeof value === "number") ?? []),
		maxHintConfidence(draft?.correctionDrafts.map((entry) => entry.confidence).filter((value) => typeof value === "number") ?? []),
		maxHintConfidence(draft?.relationDrafts?.map((entry) => entry.confidence ?? entry.relation.confidence).filter((value) => typeof value === "number") ?? [])
	]);
}
function structuredSemanticSignalConfidence(candidate) {
	const hints = candidate.structuredHints;
	return maxHintConfidence([
		...(hints?.resourceAssertions ?? []).map((entry) => entry.confidence),
		...(hints?.adviceSignals ?? []).map((entry) => entry.confidence),
		...(semanticDraft(candidate)?.resourceAssertions ?? []).map((entry) => entry.confidence),
		...(semanticDraft(candidate)?.adviceSignals ?? []).map((entry) => entry.confidence)
	]);
}
function workflowActionFromDraft(hint) {
	if (hint?.preferDurableState) return "durable_state";
	return "session_state";
}
function chooseSemanticDraftAction(candidate) {
	const reasons = [];
	const correction = candidate.structuredHints?.correction;
	const families = semanticDraftFamilies(candidate);
	const timeframes = semanticDraftTimeframes(candidate);
	const materializationHint = semanticDraftMaterializationHint(candidate);
	const draftConfidence = semanticDraftConfidence(candidate);
	const primaryFamily = materializationHint?.primaryFamily ?? families[0];
	const correctionConfidence = maxHintConfidence([correction?.confidence, draftConfidence]);
	if (primaryFamily === "workflow") {
		const action = workflowActionFromDraft(materializationHint);
		reasons.push("semantic-draft-adapter:workflow");
		return {
			action,
			reasons,
			scores: semanticDraftGateScores(action, draftConfidence)
		};
	}
	if (correction) {
		if (correction.targetKind === "relation" && primaryFamily === "relation_like" && !materializationHint?.preferEvent) {
			reasons.push("semantic-draft-adapter:relation-correction");
			return {
				action: "graph_relation",
				reasons,
				scores: semanticDraftGateScores("graph_relation", correctionConfidence)
			};
		}
		if (materializationHint?.replacementMode === "supersede_fact" || correction.targetKind === "fact" || correction.targetKind === "state" || correction.targetKind === "project_profile") {
			reasons.push("semantic-draft-adapter:fact-correction");
			return {
				action: "stable_fact",
				reasons,
				scores: semanticDraftGateScores("stable_fact", correctionConfidence)
			};
		}
		if (materializationHint?.preferEvent || correction.timeframe === "historical" || correction.timeframe === "compare" || timeframes.includes("historical") || timeframes.includes("compare")) {
			reasons.push("semantic-draft-adapter:historical-correction");
			return {
				action: "episodic_event",
				reasons,
				scores: semanticDraftGateScores("episodic_event", correctionConfidence)
			};
		}
	}
	if (primaryFamily === "strategy_like") {
		reasons.push("semantic-draft-adapter:strategy-guidance");
		return {
			action: "stable_fact",
			reasons,
			scores: semanticDraftGateScores("stable_fact", draftConfidence)
		};
	}
	if ((candidate.structuredHints?.resourceAssertions?.length ?? 0) > 0) {
		reasons.push("semantic-draft-adapter:resource-assertion");
		return {
			action: "stable_fact",
			reasons,
			scores: semanticDraftGateScores("stable_fact", maxHintConfidence([draftConfidence, structuredSemanticSignalConfidence(candidate)]))
		};
	}
	if ((candidate.structuredHints?.adviceSignals?.length ?? 0) > 0) {
		reasons.push("semantic-draft-adapter:advice-signal");
		return {
			action: "stable_fact",
			reasons,
			scores: semanticDraftGateScores("stable_fact", maxHintConfidence([draftConfidence, structuredSemanticSignalConfidence(candidate)]))
		};
	}
	if (primaryFamily === "preference" || primaryFamily === "fact_like") {
		reasons.push("semantic-draft-adapter:stable-fact");
		return {
			action: "stable_fact",
			reasons,
			scores: semanticDraftGateScores("stable_fact", draftConfidence)
		};
	}
	if (primaryFamily === "relation_like" && !materializationHint?.replacementMode && !materializationHint?.preferEvent) {
		reasons.push("semantic-draft-adapter:relation");
		return {
			action: "graph_relation",
			reasons,
			scores: semanticDraftGateScores("graph_relation", draftConfidence)
		};
	}
	if (primaryFamily === "event_like") {
		reasons.push("semantic-draft-adapter:event");
		return {
			action: "episodic_event",
			reasons,
			scores: semanticDraftGateScores("episodic_event", draftConfidence)
		};
	}
	if (candidate.source.kind === "tool") {
		if (materializationHint?.preferEvent || Boolean(correction) || primaryFamily === "event_like") {
			reasons.push("semantic-draft-adapter:tool-event");
			return {
				action: "episodic_event",
				reasons,
				scores: semanticDraftGateScores("episodic_event", draftConfidence)
			};
		}
		reasons.push("semantic-draft-adapter:tool-ignore");
		return {
			action: "ignore",
			reasons,
			scores: semanticDraftGateScores("ignore", void 0)
		};
	}
	reasons.push(materializationHint?.primaryFamily ? "semantic-draft-adapter:no-safe-owner" : "semantic-draft-adapter:no-compiler-family");
	return {
		action: "ignore",
		reasons,
		scores: semanticDraftGateScores("ignore", draftConfidence)
	};
}
function evaluatePolicyFromSemanticDraft(candidate, ctx, explicitIntent) {
	const enrichedCandidate = enrichCandidateWithSignals(candidate, derivePolicySignals(candidate, "structured-only"));
	const gated = chooseSemanticDraftAction(enrichedCandidate);
	return {
		candidate: enrichedCandidate,
		decision: finalizeDecision({
			candidate: enrichedCandidate,
			ctx,
			explicitIntent,
			proposedAction: gated.action,
			salienceScore: gated.scores.salienceScore,
			expectedFutureUtility: gated.scores.expectedFutureUtility,
			stabilityScore: gated.scores.stabilityScore,
			reasons: gated.reasons
		})
	};
}
function shouldCaptureDeclarativeHistory(candidate, signals) {
	const text = candidate.rawText.trim();
	if (candidate.source.kind !== "user" || !text) return false;
	if (isLowValueChatter(text)) return false;
	if (signals.preferenceHint || signals.workflowHint || signals.relationHint || signals.decisionHint) return false;
	if (TASK_BOUNDARY_PATTERN.test(text)) return false;
	const strongestDeclarativeClauseScore = candidate.rawText.split(/[。.!！？?；;\n]/u).map((entry) => entry.trim()).filter(Boolean).filter((clause) => !isQuestionLike(clause)).reduce((best, clause) => Math.max(best, clauseSignalScore(candidate, clause)), 0);
	if (isQuestionLike(text) && strongestDeclarativeClauseScore < 3) return false;
	const narrativeCue = (candidate.structuredHints?.timeHints?.length ?? 0) > 0 || IMPORTANT_EVENT_PATTERN.test(text) || strongestDeclarativeClauseScore >= 3;
	const minLength = /[\p{Script=Han}]/u.test(text) ? 8 : 18;
	return narrativeCue && text.length >= minLength;
}
function declarativeTimeTerms(candidate) {
	return new Set((candidate.structuredHints?.timeHints ?? []).flatMap((hint) => normalizedTerms(hint, { minLength: 2 })).filter(Boolean));
}
function clauseSignalScore(candidate, clause) {
	const clauseTerms = normalizedTerms(clause, { minLength: 2 });
	if (clauseTerms.length === 0 || isQuestionLike(clause)) return 0;
	const timeTerms = declarativeTimeTerms(candidate);
	const timeOverlap = clauseTerms.filter((term) => timeTerms.has(term));
	const numericCue = /\d/u.test(clause) || clause.includes("$") || clause.includes("%");
	let score = 0;
	if (clauseTerms.length >= 6) score += 1;
	if (clauseTerms.length >= 10) score += 1;
	if (timeOverlap.length > 0) score += 2;
	if (numericCue) score += 2;
	return score;
}
function hasDeclarativeClauseSignal(candidate) {
	return candidate.rawText.split(/[。.!！？?；;\n]/u).map((entry) => entry.trim()).filter(Boolean).some((clause) => clauseSignalScore(candidate, clause) >= 3);
}
function utilityScore(candidate, signals, mode) {
	const text = candidate.rawText;
	const entityCount = candidate.structuredHints?.entities?.length ?? 0;
	const timeHintCount = candidate.structuredHints?.timeHints?.length ?? 0;
	const declarativeClauseSignal = hasDeclarativeClauseSignal(candidate);
	let score = UTILITY_BASE;
	if (signals.preferenceHint) score += UTILITY_PREFERENCE_HINT;
	if (signals.preference) score += UTILITY_PREFERENCE;
	if (signals.decisionHint) score += UTILITY_DECISION_HINT;
	if (signals.workflowHint) score += UTILITY_WORKFLOW_HINT;
	if (signals.workflow) score += UTILITY_WORKFLOW;
	if (signals.relationHint) score += UTILITY_RELATION_HINT;
	if (candidate.source.kind === "tool") score += UTILITY_TOOL_SOURCE;
	if (candidate.source.kind === "user" && (entityCount > 0 || timeHintCount > 0)) score += Math.min(.14, entityCount * .03 + timeHintCount * .04);
	if (candidate.source.kind === "user" && declarativeClauseSignal) score += .1;
	if (mode === "heuristic") {
		if (TEMPORAL_PATTERN.test(text)) score += UTILITY_TEMPORAL_PATTERN;
		if (IMPORTANT_EVENT_PATTERN.test(text)) score += UTILITY_IMPORTANT_EVENT;
		if (signals.relationHint || STABLE_FACT_PATTERN.test(text)) score += UTILITY_FACT_OR_RELATION;
	}
	return clamp01(score + repetitionBoost(candidate));
}
function salienceScore(candidate, explicitIntent, signals, mode) {
	const text = candidate.rawText;
	const entityCount = candidate.structuredHints?.entities?.length ?? 0;
	const timeHintCount = candidate.structuredHints?.timeHints?.length ?? 0;
	const declarativeClauseSignal = hasDeclarativeClauseSignal(candidate);
	let score = SALIENCE_BASE;
	if (explicitIntent && mode === "heuristic") score += SALIENCE_EXPLICIT_INTENT;
	if (signals.preferenceHint) score += SALIENCE_PREFERENCE_HINT;
	if (signals.preference) score += SALIENCE_PREFERENCE;
	if (signals.decisionHint) score += SALIENCE_DECISION_HINT;
	if (signals.workflowHint) score += SALIENCE_WORKFLOW_HINT;
	if (signals.workflow) score += SALIENCE_WORKFLOW;
	if (signals.relationHint) score += SALIENCE_RELATION_HINT;
	if (candidate.source.kind === "tool") score += SALIENCE_TOOL_SOURCE;
	if (candidate.source.kind === "user" && (entityCount > 0 || timeHintCount > 0)) score += Math.min(.18, entityCount * .03 + timeHintCount * .05);
	if (candidate.source.kind === "user" && declarativeClauseSignal) score += .12;
	if (mode === "heuristic") {
		if (TEMPORAL_PATTERN.test(text)) score += SALIENCE_TEMPORAL_PATTERN;
		if (IMPORTANT_EVENT_PATTERN.test(text)) score += SALIENCE_IMPORTANT_EVENT;
		if (STABLE_FACT_PATTERN.test(text)) score += SALIENCE_STABLE_FACT;
		if (WORKFLOW_PATTERN.test(text)) score += SALIENCE_WORKFLOW_PATTERN;
		if (signals.relationHint) score += SALIENCE_EXTRA_RELATION;
	}
	if (isLowValueChatter(text)) score -= SALIENCE_LOW_VALUE_PENALTY;
	if (text.length < 10) score -= SALIENCE_SHORT_TEXT_PENALTY;
	return clamp01(score + repetitionBoost(candidate));
}
function stabilityScore(candidate, signals, mode) {
	let score = STABILITY_BASE;
	if (signals.preferenceHint || signals.decisionHint || mode === "heuristic" && PROFILE_PATTERN.test(candidate.rawText)) score += STABILITY_PROFILE_OR_PREFERENCE;
	if (signals.preference) score += STABILITY_PREFERENCE;
	if (signals.relationHint) score += STABILITY_RELATION_HINT;
	if (mode === "heuristic" && WORKFLOW_PATTERN.test(candidate.rawText)) score += STABILITY_WORKFLOW_PATTERN;
	if (signals.workflow) score += STABILITY_WORKFLOW;
	if (candidate.source.kind === "tool") score -= STABILITY_TOOL_PENALTY;
	if (mode === "heuristic" && TEMPORAL_PATTERN.test(candidate.rawText)) score -= STABILITY_TEMPORAL_PENALTY;
	return clamp01(score);
}
function naturalCaptureEligible(candidate, action) {
	if (candidate.source.kind !== "user") return false;
	const text = candidate.rawText.trim();
	if (!text || isLowValueChatter(text)) return false;
	return action !== "ignore";
}
function captureAuthorized(candidate, ctx, action, explicitIntent) {
	if (candidate.source.kind === "tool") return true;
	if (explicitIntent) return true;
	if (ctx.config.consentMode === "off") return false;
	if (ctx.config.autoCapture) return true;
	return naturalCaptureEligible(candidate, action);
}
function defaultScoresForAction(action) {
	const entry = DEFAULT_SCORES[action] ?? DEFAULT_SCORES.fallback;
	return {
		salienceScore: entry.salience,
		expectedFutureUtility: entry.utility,
		stabilityScore: entry.stability
	};
}
function finalizeDecision(params) {
	const sensitivity = clamp01(sensitivityScore(params.candidate.rawText) + (containsSensitiveValue(params.candidate.rawText) ? SENSITIVITY_SENSITIVE_VALUE_BOOST : 0) + (looksLikePromptInjection(params.candidate.rawText) && !containsLikelySecret(params.candidate.rawText) ? SENSITIVITY_PROMPT_INJECTION_BOOST : 0));
	const reasons = [...params.reasons];
	const hasInjectedHistory = containsUntrustedBanner(params.candidate.rawText);
	const containsSecret = containsLikelySecret(params.candidate.rawText);
	const containsSensitivePayload = containsSensitiveValue(params.candidate.rawText);
	const injectionLike = looksLikePromptInjection(params.candidate.rawText) && !containsSecret;
	const authorized = captureAuthorized(params.candidate, params.ctx, params.proposedAction, params.explicitIntent);
	if (!authorized) reasons.push("capture_not_authorized");
	if (hasInjectedHistory) reasons.push("contains_injected_history");
	if (injectionLike) reasons.push("instructional_or_sensitive_pattern");
	if (sensitivity > params.ctx.config.maxSensitivityAllowed) reasons.push("high_sensitivity_observed");
	if (containsSecret || containsSensitivePayload) reasons.push("secret_like_payload");
	if (isLowValueChatter(params.candidate.rawText)) reasons.push("low_value_chatter");
	let action = params.proposedAction;
	if (!authorized || hasInjectedHistory) action = "ignore";
	else if (injectionLike || sensitivity > params.ctx.config.maxSensitivityAllowed || containsSecret || containsSensitivePayload) action = "ignore";
	return {
		salienceScore: clamp01(params.salienceScore),
		expectedFutureUtility: clamp01(params.expectedFutureUtility),
		sensitivityScore: sensitivity,
		stabilityScore: clamp01(params.stabilityScore),
		action,
		reasons,
		explicitIntent: params.explicitIntent,
		captureAuthorized: authorized
	};
}
function evaluatePolicyFromStructuredHints(candidate, ctx, explicitIntent) {
	const signals = derivePolicySignals(candidate, "structured-only");
	const reasons = [];
	const utility = utilityScore(candidate, signals, "structured-only");
	const salience = salienceScore(candidate, explicitIntent, signals, "structured-only");
	const stability = stabilityScore(candidate, signals, "structured-only");
	const declarativeHistoryFloor = Math.max(.24, Math.min(ctx.config.minSalienceSession, EPISODIC_MIN_SALIENCE_FALLBACK) - .08);
	let action = "ignore";
	if (signals.workflowHint && salience >= ctx.config.minSalienceDurable) {
		action = "durable_state";
		reasons.push("safety-mode:structured-workflow-state");
	} else if (signals.workflowHint && salience >= ctx.config.minSalienceSession) {
		action = "session_state";
		reasons.push("safety-mode:structured-workflow-state");
	} else if (candidate.structuredHints?.correction && candidate.structuredHints.correction.targetKind !== "relation" && salience >= ctx.config.minSalienceSession) {
		action = "stable_fact";
		reasons.push("safety-mode:explicit-correction");
	} else if ((candidate.source.kind === "tool" || looksLikePromptInjection(candidate.rawText) || containsSensitiveValue(candidate.rawText) || sensitivityScore(candidate.rawText) > ctx.config.maxSensitivityAllowed) && salience >= Math.min(ctx.config.minSalienceSession, .35)) {
		action = "episodic_event";
		reasons.push("safety-mode:episodic-event");
	} else if (shouldCaptureDeclarativeHistory(candidate, signals) && salience >= declarativeHistoryFloor) {
		action = "episodic_event";
		reasons.push("safety-mode:declarative-history");
	} else if (salience < ctx.config.minSalienceSession) reasons.push("below_session_threshold");
	const enrichedCandidate = enrichCandidateWithSignals(candidate, signals);
	return {
		candidate: enrichedCandidate,
		decision: finalizeDecision({
			candidate: enrichedCandidate,
			ctx,
			explicitIntent,
			proposedAction: action,
			salienceScore: salience,
			expectedFutureUtility: utility,
			stabilityScore: stability,
			reasons
		})
	};
}
async function evaluatePolicy(candidate, ctx, options = {}) {
	const explicitIntent = hasExplicitRememberIntent(normalizeText(candidate.rawText));
	const questionLikeWithoutExplicitIntent = candidate.source.kind === "user" && (isQuestionLike(candidate.rawText) || isHypotheticalReferenceRule(candidate.rawText)) && !candidate.structuredHints?.correctionHint && !explicitIntent;
	if (ctx.config.advanced.enableTurnSemanticCompiler) {
		const compiledPolicy = evaluatePolicyFromSemanticDraft(candidate, ctx, explicitIntent);
		if (candidate.source.kind === "user" && compiledPolicy.decision.action === "ignore" && compiledPolicy.decision.reasons.some((reason) => reason === "semantic-draft-adapter:no-compiler-family" || reason === "semantic-draft-adapter:no-safe-owner")) {
			const degraded = evaluatePolicyFromStructuredHints(candidate, ctx, explicitIntent);
			if (degraded.decision.action === "episodic_event" && degraded.decision.captureAuthorized) {
				recordMemoryLlmBudgetCall(ctx.llmBudgetAudit, {
					label: "candidate-policy",
					stage: inferWriteLlmStage(candidate.source.kind),
					provenance: "deterministic",
					mode: "deterministic",
					detail: "candidate-policy used a deterministic episodic safety floor after compiler draft miss"
				});
				return {
					candidate: degraded.candidate,
					decision: {
						...degraded.decision,
						reasons: [...degraded.decision.reasons, "semantic-draft-episodic-floor"]
					}
				};
			}
		}
		recordMemoryLlmBudgetCall(ctx.llmBudgetAudit, {
			label: "candidate-policy",
			stage: inferWriteLlmStage(candidate.source.kind),
			provenance: "deterministic",
			mode: "deterministic",
			detail: "candidate-policy consumed semantic draft as a deterministic gate/adapter"
		});
		return {
			candidate: compiledPolicy.candidate,
			decision: {
				...compiledPolicy.decision,
				reasons: [...compiledPolicy.decision.reasons, "semantic-compiler-policy-adapter"]
			}
		};
	}
	if (!options.reasoner) {
		const safetyMode = evaluatePolicyFromStructuredHints(candidate, ctx, explicitIntent);
		recordMemoryLlmBudgetCall(ctx.llmBudgetAudit, {
			label: "candidate-policy",
			stage: inferWriteLlmStage(candidate.source.kind),
			provenance: "deterministic",
			mode: "degraded",
			detail: "candidate-policy resolved in deterministic safety mode without compiler"
		});
		return safetyMode;
	}
	const degraded = evaluatePolicyFromStructuredHints(candidate, ctx, explicitIntent);
	const judgment = await options.reasoner?.judgeCandidatePolicy(candidate, {
		stage: inferWriteLlmStage(candidate.source.kind),
		audit: ctx.llmBudgetAudit
	});
	if (!judgment?.action) return {
		candidate: degraded.candidate,
		decision: {
			...degraded.decision,
			reasons: [...degraded.decision.reasons, "llm:missing-or-invalid-judgment"]
		}
	};
	const enrichedCandidate = enrichCandidateWithLlmJudgment(degraded.candidate, judgment);
	const defaultScores = defaultScoresForAction(judgment.action);
	const reasons = [`llm:${judgment.reason ?? "semantic policy judgment"}`];
	if (enrichedCandidate.source.kind === "user" && isQuestionLike(enrichedCandidate.rawText) && judgment.action !== "ignore") reasons.push("llm_overrode_question_shape");
	const proposedAction = questionLikeWithoutExplicitIntent && (judgment.action === "session_state" || judgment.action === "durable_state") ? "ignore" : judgment.action;
	if (proposedAction === "ignore" && proposedAction !== judgment.action) reasons.push("question_like_state_write_blocked");
	const decision = finalizeDecision({
		candidate: enrichedCandidate,
		ctx,
		explicitIntent,
		proposedAction,
		salienceScore: judgment.salienceScore ?? defaultScores.salienceScore,
		expectedFutureUtility: judgment.expectedFutureUtility ?? defaultScores.expectedFutureUtility,
		stabilityScore: judgment.stabilityScore ?? defaultScores.stabilityScore,
		reasons
	});
	if (decision.action === "ignore" && hasStructuredSemanticSignal(enrichedCandidate)) {
		if (degraded.decision.captureAuthorized && degraded.decision.action !== "ignore") return {
			candidate: enrichedCandidate,
			decision: {
				...degraded.decision,
				reasons: [...degraded.decision.reasons, "structured-signal-floor"]
			}
		};
	}
	if (decision.action === "ignore" && degraded.decision.action === "episodic_event" && degraded.decision.captureAuthorized) return {
		candidate: enrichedCandidate,
		decision: {
			...degraded.decision,
			reasons: [...degraded.decision.reasons, "narrative-event-floor"]
		}
	};
	return {
		candidate: enrichedCandidate,
		decision
	};
}
//#endregion
export { evaluatePolicy };
