import { clamp01, objectRecord } from "../support.js";
import type {
  MemoryWorkflowStateKind,
  MemxStateLifecycleKind,
  NormalizedState,
  StateCurrentness,
} from "../types.js";

type StateLikeInput = {
  key: string;
  stateKind?: MemoryWorkflowStateKind;
  valueJson?: Record<string, unknown>;
  sourceRef?: string;
  supportRefs?: string[];
  updatedAt?: string;
  observedAt?: string;
  validFrom?: string;
  expiresAt?: string;
  scope?: string;
  sessionKey?: string;
  taskId?: string;
};

type StateVectorMetadata = Record<string, unknown>;

const TASK_CHECKPOINT_KEYS = new Set([
  "workflow.current_task",
  "workflow.task_phase",
  "workflow.candidate_resolution",
  "workflow.active_decision",
]);

const SESSION_WORKING_PREFIXES = ["workflow.", "session.", "working."];

const RESOLVED_TRANSIENT_STATUSES = new Set([
  "resolved",
  "completed",
  "closed",
  "cancelled",
  "superseded",
]);

export function classifyStateLifecycle(input: StateLikeInput): MemxStateLifecycleKind {
  const sourceRef = input.sourceRef ?? "";
  if (sourceRef.startsWith("abstraction_candidate:")) {
    return "derived_maintenance";
  }
  if (input.key === "workflow.blocker") {
    return "transient_blocker";
  }
  if (input.key === "workflow.next_action") {
    return "transient_next_step";
  }
  if (TASK_CHECKPOINT_KEYS.has(input.key)) {
    return "task_checkpoint";
  }
  if (input.stateKind === "durable") {
    return "durable_profile";
  }
  if (SESSION_WORKING_PREFIXES.some((prefix) => input.key.startsWith(prefix))) {
    return "session_working";
  }
  return "session_working";
}

export function evaluateStateCurrentness(
  input: StateLikeInput & { now: string },
): StateCurrentness {
  const lifecycleKind = classifyStateLifecycle(input);
  const durable = input.stateKind === "durable" || lifecycleKind === "durable_profile";
  const observedAt = input.observedAt ?? input.updatedAt;
  const supportRefs = stateSupportRefs(input);
  const supersededBy = stateSupersededBy(input.valueJson);
  const expiresAt = input.expiresAt;
  const expired = isPast(expiresAt, input.now);
  const resolvedTransient =
    isResolvedTransient(input.valueJson) &&
    (lifecycleKind === "transient_blocker" || lifecycleKind === "transient_next_step");
  const hardExclusions = [
    ...(expired ? ["expired-state"] : []),
    ...(supersededBy ? ["superseded-state"] : []),
    ...(resolvedTransient ? ["resolved-transient-state"] : []),
  ];
  const maintenanceDerived = lifecycleKind === "derived_maintenance";
  const rawSupportRefs = supportRefs.filter((ref) => !ref.startsWith("abstraction_candidate:"));
  const softPenalties = [
    ...(maintenanceDerived ? ["maintenance-derived-state"] : []),
    ...(maintenanceDerived && rawSupportRefs.length === 0
      ? ["maintenance-derived-without-raw-support"]
      : []),
    ...(lifecycleKind === "task_checkpoint" ? ["task-checkpoint-state"] : []),
  ];
  const freshness = freshnessScore(observedAt, input.now, lifecycleKind);
  const lifecycleBase = lifecycleBaseScore(lifecycleKind, durable);
  const sourceTrace = supportRefs.length > 1 ? 1 : supportRefs.length === 1 ? 0.78 : 0.44;
  const durableFit = durable ? 0.9 : 0.58;
  const hardPenalty = hardExclusions.length > 0 ? 0.76 : 0;
  const softPenalty = Math.min(0.34, softPenalties.length * 0.09);
  const currentnessScore = clamp01(
    lifecycleBase * 0.36 +
      freshness * 0.28 +
      sourceTrace * 0.2 +
      durableFit * 0.16 -
      hardPenalty -
      softPenalty,
  );

  return {
    lifecycleKind,
    currentnessScore,
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
    answerEligibleByDefault:
      hardExclusions.length === 0 &&
      rawSupportRefs.length > 0 &&
      lifecycleKind !== "task_checkpoint" &&
      lifecycleKind !== "derived_maintenance",
  };
}

export function stateCurrentnessVectorMetadata(
  state: NormalizedState,
  now = state.updatedAt,
): Record<string, unknown> {
  const currentness = evaluateStateCurrentness({
    key: state.key,
    stateKind: state.stateKind,
    valueJson: state.valueJson,
    sourceRef: state.sourceRef,
    updatedAt: state.updatedAt,
    observedAt: state.updatedAt,
    expiresAt: state.expiresAt,
    scope: state.scope,
    now,
  });
  return stateCurrentnessToMetadata(currentness);
}

export function stateCurrentnessFromVectorMetadata(
  metadata: StateVectorMetadata | undefined,
  now: string,
): StateCurrentness | undefined {
  if (!metadata || metadata.memxDocType !== "state") {
    return undefined;
  }
  const key = stringValue(metadata.stateKey) ?? stringValue(metadata.key);
  if (!key) {
    return undefined;
  }
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
    now,
  });
}

export function stateCurrentnessToMetadata(currentness: StateCurrentness): Record<string, unknown> {
  const currentnessHint =
    currentness.hardExclusions.length > 0
      ? "historical"
      : currentness.currentnessScore >= 0.45
        ? "current"
        : "unknown";
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
    currentnessHint,
  };
}

export function stateSupportRefs(input: StateLikeInput): string[] {
  const refs = new Set<string>();
  for (const ref of input.supportRefs ?? []) {
    if (ref) refs.add(ref);
  }
  const value = objectRecord(input.valueJson);
  for (const key of ["supportRefs", "sourceRefs", "supportContentRefs", "derivedFromRefs"]) {
    for (const ref of stringArray(value?.[key])) {
      refs.add(ref);
    }
  }
  if (input.sourceRef) {
    refs.add(input.sourceRef);
  }
  return [...refs];
}

function stateSupersededBy(valueJson: Record<string, unknown> | undefined): string | undefined {
  const value = objectRecord(valueJson);
  if (!value) return undefined;
  return (
    stringValue(value.supersededBy) ??
    stringValue(value.superseded_by) ??
    stringValue(value.replacedBy)
  );
}

function isResolvedTransient(valueJson: Record<string, unknown> | undefined): boolean {
  const value = objectRecord(valueJson);
  if (!value) return false;
  const status = stringValue(value.status)?.trim().toLowerCase();
  return status ? RESOLVED_TRANSIENT_STATUSES.has(status) : false;
}

function isPast(iso: string | undefined, nowIso: string): boolean {
  if (!iso) return false;
  const at = Date.parse(iso);
  const now = Date.parse(nowIso);
  return Number.isFinite(at) && Number.isFinite(now) && at <= now;
}

function freshnessScore(
  observedAt: string | undefined,
  nowIso: string,
  lifecycleKind: MemxStateLifecycleKind,
): number {
  if (!observedAt) return 0.55;
  const observed = Date.parse(observedAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(observed) || !Number.isFinite(now)) return 0.55;
  const ageHours = Math.max(0, (now - observed) / 3_600_000);
  const halfLifeHours =
    lifecycleKind === "durable_profile"
      ? 24 * 180
      : lifecycleKind === "derived_maintenance"
        ? 24 * 21
        : lifecycleKind === "task_checkpoint"
          ? 24 * 7
          : lifecycleKind === "session_working"
            ? 24 * 3
            : 24 * 1.5;
  return clamp01(Math.exp(-ageHours / halfLifeHours));
}

function lifecycleBaseScore(kind: MemxStateLifecycleKind, durable: boolean): number {
  switch (kind) {
    case "durable_profile":
      return 0.92;
    case "session_working":
      return durable ? 0.78 : 0.68;
    case "transient_blocker":
      return 0.64;
    case "transient_next_step":
      return 0.62;
    case "task_checkpoint":
      return 0.48;
    case "derived_maintenance":
      return 0.44;
  }
  return durable ? 0.68 : 0.44;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
