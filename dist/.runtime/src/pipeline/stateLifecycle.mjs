import { clamp01, objectRecord } from "../support.mjs";
//#region src/pipeline/stateLifecycle.ts
const TASK_CHECKPOINT_KEYS = new Set([
	"workflow.current_task",
	"workflow.task_phase",
	"workflow.candidate_resolution",
	"workflow.active_decision"
]);
const SESSION_WORKING_PREFIXES = [
	"workflow.",
	"session.",
	"working."
];
const RESOLVED_TRANSIENT_STATUSES = new Set([
	"resolved",
	"completed",
	"closed",
	"cancelled",
	"superseded"
]);
function classifyStateLifecycle(input) {
	if ((input.sourceRef ?? "").startsWith("abstraction_candidate:")) return "derived_maintenance";
	if (input.key === "workflow.blocker") return "transient_blocker";
	if (input.key === "workflow.next_action") return "transient_next_step";
	if (TASK_CHECKPOINT_KEYS.has(input.key)) return "task_checkpoint";
	if (input.stateKind === "durable") return "durable_profile";
	if (SESSION_WORKING_PREFIXES.some((prefix) => input.key.startsWith(prefix))) return "session_working";
	return "session_working";
}
function evaluateStateCurrentness(input) {
	const lifecycleKind = classifyStateLifecycle(input);
	const durable = input.stateKind === "durable" || lifecycleKind === "durable_profile";
	const observedAt = input.observedAt ?? input.updatedAt;
	const supportRefs = stateSupportRefs(input);
	const supersededBy = stateSupersededBy(input.valueJson);
	const expiresAt = input.expiresAt;
	const expired = isPast(expiresAt, input.now);
	const resolvedTransient = isResolvedTransient(input.valueJson) && (lifecycleKind === "transient_blocker" || lifecycleKind === "transient_next_step");
	const hardExclusions = [
		...expired ? ["expired-state"] : [],
		...supersededBy ? ["superseded-state"] : [],
		...resolvedTransient ? ["resolved-transient-state"] : []
	];
	const maintenanceDerived = lifecycleKind === "derived_maintenance";
	const rawSupportRefs = supportRefs.filter((ref) => !ref.startsWith("abstraction_candidate:"));
	const softPenalties = [
		...maintenanceDerived ? ["maintenance-derived-state"] : [],
		...maintenanceDerived && rawSupportRefs.length === 0 ? ["maintenance-derived-without-raw-support"] : [],
		...lifecycleKind === "task_checkpoint" ? ["task-checkpoint-state"] : []
	];
	const freshness = freshnessScore(observedAt, input.now, lifecycleKind);
	const lifecycleBase = lifecycleBaseScore(lifecycleKind, durable);
	const sourceTrace = supportRefs.length > 1 ? 1 : supportRefs.length === 1 ? .78 : .44;
	const durableFit = durable ? .9 : .58;
	const hardPenalty = hardExclusions.length > 0 ? .76 : 0;
	const softPenalty = Math.min(.34, softPenalties.length * .09);
	return {
		lifecycleKind,
		currentnessScore: clamp01(lifecycleBase * .36 + freshness * .28 + sourceTrace * .2 + durableFit * .16 - hardPenalty - softPenalty),
		durable,
		observedAt,
		validFrom: input.validFrom ?? observedAt,
		expiresAt,
		supersededBy,
		sourceRef: input.sourceRef,
		supportRefs,
		sessionKey: input.sessionKey,
		taskId: input.taskId,
		hardExclusions,
		softPenalties,
		answerEligibleByDefault: hardExclusions.length === 0 && rawSupportRefs.length > 0 && lifecycleKind !== "task_checkpoint" && lifecycleKind !== "derived_maintenance"
	};
}
function stateCurrentnessVectorMetadata(state, now = state.updatedAt) {
	return stateCurrentnessToMetadata(evaluateStateCurrentness({
		key: state.key,
		stateKind: state.stateKind,
		valueJson: state.valueJson,
		sourceRef: state.sourceRef,
		updatedAt: state.updatedAt,
		observedAt: state.updatedAt,
		expiresAt: state.expiresAt,
		scope: state.scope,
		now
	}));
}
function stateCurrentnessFromVectorMetadata(metadata, now) {
	if (!metadata || metadata.memxDocType !== "state") return;
	const key = stringValue(metadata.stateKey) ?? stringValue(metadata.key);
	if (!key) return;
	return evaluateStateCurrentness({
		key,
		stateKind: stringValue(metadata.stateKind) === "durable" ? "durable" : "session",
		sourceRef: stringValue(metadata.sourceRef),
		supportRefs: stringArray(metadata.stateSupportRefs),
		updatedAt: stringValue(metadata.updatedAt) ?? stringValue(metadata.observedAt),
		observedAt: stringValue(metadata.stateObservedAt) ?? stringValue(metadata.observedAt),
		expiresAt: stringValue(metadata.expiresAt) ?? stringValue(metadata.stateExpiresAt),
		sessionKey: stringValue(metadata.sessionKey),
		taskId: stringValue(metadata.taskId),
		now
	});
}
function stateCurrentnessToMetadata(currentness) {
	const currentnessHint = currentness.hardExclusions.length > 0 ? "historical" : currentness.currentnessScore >= .45 ? "current" : "unknown";
	return {
		stateLifecycleKind: currentness.lifecycleKind,
		stateCurrentnessScore: currentness.currentnessScore,
		stateDurable: currentness.durable,
		stateObservedAt: currentness.observedAt,
		stateValidFrom: currentness.validFrom,
		stateExpiresAt: currentness.expiresAt,
		stateSupersededBy: currentness.supersededBy,
		stateSupportRefs: currentness.supportRefs,
		stateCurrentnessHardExclusions: currentness.hardExclusions,
		stateCurrentnessSoftPenalties: currentness.softPenalties,
		stateAnswerEligibleByDefault: currentness.answerEligibleByDefault,
		activeHint: currentness.hardExclusions.length === 0,
		supersededHint: currentness.hardExclusions.includes("superseded-state"),
		currentnessHint
	};
}
function stateSupportRefs(input) {
	const refs = /* @__PURE__ */ new Set();
	for (const ref of input.supportRefs ?? []) if (ref) refs.add(ref);
	const value = objectRecord(input.valueJson);
	for (const key of [
		"supportRefs",
		"sourceRefs",
		"supportContentRefs",
		"derivedFromRefs"
	]) for (const ref of stringArray(value?.[key])) refs.add(ref);
	if (input.sourceRef) refs.add(input.sourceRef);
	return [...refs];
}
function stateSupersededBy(valueJson) {
	const value = objectRecord(valueJson);
	if (!value) return void 0;
	return stringValue(value.supersededBy) ?? stringValue(value.superseded_by) ?? stringValue(value.replacedBy);
}
function isResolvedTransient(valueJson) {
	const value = objectRecord(valueJson);
	if (!value) return false;
	const status = stringValue(value.status)?.trim().toLowerCase();
	return status ? RESOLVED_TRANSIENT_STATUSES.has(status) : false;
}
function isPast(iso, nowIso) {
	if (!iso) return false;
	const at = Date.parse(iso);
	const now = Date.parse(nowIso);
	return Number.isFinite(at) && Number.isFinite(now) && at <= now;
}
function freshnessScore(observedAt, nowIso, lifecycleKind) {
	if (!observedAt) return .55;
	const observed = Date.parse(observedAt);
	const now = Date.parse(nowIso);
	if (!Number.isFinite(observed) || !Number.isFinite(now)) return .55;
	const ageHours = Math.max(0, (now - observed) / 36e5);
	const halfLifeHours = lifecycleKind === "durable_profile" ? 4320 : lifecycleKind === "derived_maintenance" ? 504 : lifecycleKind === "task_checkpoint" ? 168 : lifecycleKind === "session_working" ? 72 : 24 * 1.5;
	return clamp01(Math.exp(-ageHours / halfLifeHours));
}
function lifecycleBaseScore(kind, durable) {
	switch (kind) {
		case "durable_profile": return .92;
		case "session_working": return durable ? .78 : .68;
		case "transient_blocker": return .64;
		case "transient_next_step": return .62;
		case "task_checkpoint": return .48;
		case "derived_maintenance": return .44;
	}
	return durable ? .68 : .44;
}
function stringValue(value) {
	return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function stringArray(value) {
	if (!Array.isArray(value)) return [];
	return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}
//#endregion
export { evaluateStateCurrentness, stateCurrentnessFromVectorMetadata, stateCurrentnessToMetadata, stateCurrentnessVectorMetadata };
