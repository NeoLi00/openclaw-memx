import type {
  MemoryCandidatePreferenceHint,
  MemoryCandidateRelationHint,
  MemoryCandidateWorkflowHint,
  NormalizedState,
} from "../types.js";
import { canonicalStateKey } from "./semantic/heuristics.js";
import {
  isProjectProfileStateKey,
  looksLikeProjectDescriptor,
  projectIdentityKey,
  resolveProjectReference,
} from "./projectIdentity.js";

export const TASK_METADATA_WORKFLOW_SNAPSHOT_DESCRIPTORS = [
  {
    metadataKey: "currentTask",
    stateKey: "workflow.current_task",
    baseScore: 0.9,
    confidence: 0.86,
  },
  {
    metadataKey: "nextAction",
    stateKey: "workflow.next_action",
    baseScore: 0.88,
    confidence: 0.84,
  },
] as const;

export const SNAPSHOT_ALLOWED_STATE_KEYS = new Set([
  "project.active_project",
  "workflow.current_consideration",
  "workflow.decision",
]);

export const SNAPSHOT_SUPPRESSED_WORKFLOW_STATE_KEYS = new Set([
  "workflow.current_task",
  "workflow.next_action",
  "workflow.blocker",
  "workflow.current_strategy",
  "workflow.debugging_strategy",
  "workflow.context",
  "workflow.guideline",
  "workflow.task_phase",
  "workflow.candidate_resolution",
]);

export const BACKGROUND_ANCHORED_WORKFLOW_STATE_KEYS = new Set([
  "workflow.current_task",
  "workflow.next_action",
  "workflow.current_consideration",
]);

export const CANONICAL_WORKFLOW_STATE_KEYS = new Set([
  "workflow.current_task",
  "workflow.next_action",
  "workflow.blocker",
  "workflow.current_consideration",
  "project.active_project",
  "workflow.decision",
]);

export type CanonicalOwnerKind =
  | "state"
  | "fact"
  | "event"
  | "graph"
  | "task_metadata"
  | "projection";

type TaskMetadataKey = "project" | "currentTask" | "nextAction" | "blocker";

const TASK_METADATA_DEICTIC_RE =
  /^(?:it|this|that|this one|that one|that line|this line|which one|哪条线|哪边|那条线|这条线|这边|那边|这里|那里|前一个项目|后一个项目|搜索那边)$/iu;
const TASK_METADATA_AMBIGUOUS_RE =
  /(?:哪条线|哪边|搜索那边|前一个项目|后一个项目|这条线|那条线|这边|那边|应该知道我说的是)/u;
const TASK_METADATA_LIST_RE = /(?:,|，|、|\band\b|\bor\b|\/|\|)/iu;
const TASK_METADATA_SENTENCE_RE = /[。！？!?]/u;
const TASK_METADATA_WRAPPER_RE = /^[\s"'“”‘’`《》〈〉「」『』\[\]()（）【】]+|[\s"'“”‘’`《》〈〉「」『』\[\]()（）【】]+$/gu;
const TASK_METADATA_LEADING_PUNCT_RE = /^[,，。:：;；、-]+/u;

function normalizeTaskMetadataText(value: string): string {
  return value.replace(TASK_METADATA_WRAPPER_RE, "").replace(/\s+/g, " ").trim();
}

function sanitizeAtomicTaskMetadataValue(
  key: Exclude<TaskMetadataKey, "project">,
  value: string,
): string | undefined {
  const normalized = normalizeTaskMetadataText(value);
  if (!normalized) {
    return undefined;
  }
  if (
    normalized.length < 2 ||
    normalized.length > 96 ||
    TASK_METADATA_LEADING_PUNCT_RE.test(normalized) ||
    TASK_METADATA_DEICTIC_RE.test(normalized) ||
    TASK_METADATA_AMBIGUOUS_RE.test(normalized) ||
    TASK_METADATA_LIST_RE.test(normalized) ||
    TASK_METADATA_SENTENCE_RE.test(normalized)
  ) {
    return undefined;
  }
  if (key !== "nextAction" && looksLikeProjectDescriptor(normalized)) {
    return undefined;
  }
  return normalized;
}

function sanitizeProjectMetadataValue(
  value: string,
  params?: {
    currentProject?: string;
    knownProjects?: string[];
  },
): string | undefined {
  const normalized = normalizeTaskMetadataText(value);
  if (!normalized) {
    return undefined;
  }
  if (
    normalized.length < 2 ||
    normalized.length > 64 ||
    TASK_METADATA_LEADING_PUNCT_RE.test(normalized) ||
    TASK_METADATA_DEICTIC_RE.test(normalized) ||
    TASK_METADATA_AMBIGUOUS_RE.test(normalized) ||
    TASK_METADATA_LIST_RE.test(normalized) ||
    looksLikeProjectDescriptor(normalized)
  ) {
    return undefined;
  }
  const resolved = resolveProjectReference(normalized, {
    currentProject: params?.currentProject,
    knownProjects: params?.knownProjects,
    allowDescriptorAlias: Boolean(params?.currentProject || (params?.knownProjects?.length ?? 0) > 0),
  });
  const candidate = normalizeTaskMetadataText(resolved || normalized);
  if (!candidate || TASK_METADATA_LIST_RE.test(candidate)) {
    return undefined;
  }
  return candidate;
}

export function sanitizeTaskMetadataValue(
  key: TaskMetadataKey,
  value: unknown,
  params?: {
    currentProject?: string;
    knownProjects?: string[];
  },
): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  if (key === "project") {
    return sanitizeProjectMetadataValue(value, params);
  }
  return sanitizeAtomicTaskMetadataValue(key, value);
}

export function sanitizeTaskMetadata(
  metadata: Record<string, unknown> | undefined,
  params?: {
    currentProject?: string;
    knownProjects?: string[];
  },
): Partial<Record<TaskMetadataKey, string>> {
  if (!metadata) {
    return {};
  }
  const project = sanitizeTaskMetadataValue("project", metadata.project, params);
  const currentTask = sanitizeTaskMetadataValue("currentTask", metadata.currentTask, params);
  const nextAction = sanitizeTaskMetadataValue("nextAction", metadata.nextAction, params);
  const blocker = sanitizeTaskMetadataValue("blocker", metadata.blocker, params);
  return {
    ...(project ? { project } : {}),
    ...(currentTask ? { currentTask } : {}),
    ...(nextAction ? { nextAction } : {}),
    ...(blocker ? { blocker } : {}),
  };
}

export function hasProjectIdentityConflict(values: string[]): boolean {
  const normalized = [...new Set(values.map((value) => projectIdentityKey(value)).filter(Boolean))];
  return normalized.length > 1;
}

export function isSnapshotFactualStateKey(key: string): boolean {
  if (SNAPSHOT_ALLOWED_STATE_KEYS.has(key)) {
    return true;
  }
  if (key.startsWith("project.")) {
    return true;
  }
  if (SNAPSHOT_SUPPRESSED_WORKFLOW_STATE_KEYS.has(key)) {
    return false;
  }
  return !key.startsWith("workflow.");
}

export function isCanonicalWorkflowStateKey(key: string): boolean {
  return isProjectProfileStateKey(key) || CANONICAL_WORKFLOW_STATE_KEYS.has(key);
}

export function canonicalOwnerForWorkflowStateKey(key: string): CanonicalOwnerKind | null {
  return isCanonicalWorkflowStateKey(key) ? "state" : null;
}

export function canonicalOwnerForPreferenceHint(
  _preference: Pick<MemoryCandidatePreferenceHint, "predicate">,
): CanonicalOwnerKind {
  return "fact";
}

export function canonicalOwnerForRelationHint(
  relation: Pick<MemoryCandidateRelationHint, "predicate" | "relationSlot">,
): CanonicalOwnerKind {
  return relation.relationSlot ? "state" : "graph";
}

export function sanitizeWorkflowHint(
  workflow: MemoryCandidateWorkflowHint,
): MemoryCandidateWorkflowHint | null {
  const key = canonicalStateKey(workflow.key);
  if (!isCanonicalWorkflowStateKey(key)) {
    return null;
  }
  return {
    ...workflow,
    key,
  };
}

export function shouldDeriveProjectProfileArtifacts(state: Pick<NormalizedState, "key" | "stateKind">): boolean {
  return state.stateKind === "durable" && isProjectProfileStateKey(state.key);
}

export function shouldDeriveRelationFact(
  relation: Pick<MemoryCandidateRelationHint, "predicate" | "relationSlot">,
): boolean {
  return canonicalOwnerForRelationHint(relation) === "fact";
}

export function shouldMaterializePreferenceFact(
  preference: Pick<MemoryCandidatePreferenceHint, "predicate" | "object">,
): boolean {
  return Boolean(preference.predicate.trim() && preference.object.trim());
}

export function shouldProjectActiveProjectAlias(): boolean {
  return false;
}
