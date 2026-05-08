import { normalizeText } from "../support.js";
import type {
  MemoryCandidateCorrectionHint,
  MemoryCandidateDecisionHint,
  MemoryCandidatePreferenceHint,
  MemoryCandidateRelationHint,
  MemoryCandidateWorkflowHint,
  RecallQueryShape,
} from "../types.js";
import {
  analyzeCorrectionHint,
  analyzeRecallQueryShape,
  canonicalStateKey,
  expandStateKeyAliases,
  extractTimeHints,
  extractQueryAnchors,
  hasExplicitRememberIntent,
  inferEntityNames,
  isDeicticWorkflowReferenceQuery,
  isBroadTemporalQuery,
  isLowValueChatter,
  isQuestionLike,
  normalizedEntityId,
  normalizeGraphRelationType,
  parseAllRelations,
  parseRelation,
  predicateHint,
  queryAnchorSupport,
  seedEntityNamesFromQuery,
  semanticRoleHint,
  stripLead,
  tokenizeSearchTerms,
  wantsProjectProfileSnapshot,
  wantsCurrentFactualSnapshot,
  wantsHistoricalFacts,
} from "./semantic/heuristics.js";
import {
  judgePreferenceSignal,
  judgeQueryRoute,
  judgeRelationHint,
  judgeAllRelationHints,
  judgeWorkflowState,
  routeExplanatory,
  routeFactual,
  routeTemporal,
  routeWorkflow,
} from "./semantic/judges.js";

type SemanticHintSummary = {
  entities: Array<{ name: string; type?: string }>;
  timeHints: string[];
  preference: MemoryCandidatePreferenceHint | null;
  workflow: MemoryCandidateWorkflowHint | null;
  workflows: MemoryCandidateWorkflowHint[];
  relation: MemoryCandidateRelationHint | null;
  relations: MemoryCandidateRelationHint[];
  decision: MemoryCandidateDecisionHint | null;
  correction: MemoryCandidateCorrectionHint | null;
};

const LEGACY_PREFERENCE_VERBS = new Set([
  "adopts",
  "configures",
  "does",
  "follows",
  "gets",
  "is",
  "likes",
  "needs",
  "sets",
  "wants",
]);

export {
  analyzeCorrectionHint,
  analyzeRecallQueryShape,
  canonicalStateKey,
  expandStateKeyAliases,
  extractTimeHints,
  extractQueryAnchors,
  hasExplicitRememberIntent,
  inferEntityNames,
  isDeicticWorkflowReferenceQuery,
  isBroadTemporalQuery,
  isLowValueChatter,
  isQuestionLike,
  normalizedEntityId,
  normalizeGraphRelationType,
  parseAllRelations,
  parseRelation,
  predicateHint,
  queryAnchorSupport,
  routeExplanatory,
  routeFactual,
  routeTemporal,
  routeWorkflow,
  seedEntityNamesFromQuery,
  semanticRoleHint,
  tokenizeSearchTerms,
  wantsProjectProfileSnapshot,
  wantsCurrentFactualSnapshot,
  wantsHistoricalFacts,
  judgeQueryRoute,
};

function startOfUtcDay(iso: string, dayOffset = 0): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function subtractDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

export function inferTemporalSince(query: string, now: string): string | undefined {
  const hints = extractTimeHints(query)
    .map((hint) => hint.trim().toLowerCase())
    .filter(Boolean);
  if (hints.length === 0) {
    return undefined;
  }
  if (hints.some((hint) => /^\d{4}-\d{2}-\d{2}$/.test(hint))) {
    const isoDate = hints.find((hint) => /^\d{4}-\d{2}-\d{2}$/.test(hint));
    return isoDate ? `${isoDate}T00:00:00.000Z` : undefined;
  }
  if (hints.some((hint) => hint === "today" || hint === "今天")) {
    return startOfUtcDay(now);
  }
  if (hints.some((hint) => hint === "yesterday" || hint === "昨天")) {
    return startOfUtcDay(now, -1);
  }
  if (hints.some((hint) => hint === "last week" || hint === "上周")) {
    return subtractDays(now, 7);
  }
  if (hints.some((hint) => hint === "last month" || hint === "上个月")) {
    return subtractDays(now, 30);
  }
  if (hints.some((hint) => hint === "recently" || hint === "最近")) {
    return subtractDays(now, 14);
  }
  return undefined;
}

export function parsePreferenceSignal(text: string): { predicate: string; object: string } | null {
  const judgment = judgePreferenceSignal(text);
  if (!judgment) {
    return null;
  }
  const predicate = canonicalizePreferencePredicate(judgment.predicate);
  if (!predicate) {
    return null;
  }
  return {
    predicate,
    object: judgment.object,
  };
}

export function canonicalizePreferencePredicate(value: string): string | null {
  const normalized = normalizeText(value)
    .replace(/[^\p{L}\p{N}_]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) {
    return null;
  }
  if (normalized === "prefers_style") {
    return "prefers_response_style";
  }
  if (normalized === "prefers_charset") {
    return "prefers_output_charset";
  }
  if (normalized === "prefers") {
    return normalized;
  }
  const underscore = normalized.indexOf("_");
  if (underscore === -1) {
    return LEGACY_PREFERENCE_VERBS.has(normalized) ? "prefers" : null;
  }
  const verb = normalized.slice(0, underscore);
  const topic = normalized.slice(underscore + 1).trim();
  if (!topic) {
    return verb === "prefers" || LEGACY_PREFERENCE_VERBS.has(verb) ? "prefers" : null;
  }
  if (verb === "prefers") {
    return `prefers_${topic}`;
  }
  if (LEGACY_PREFERENCE_VERBS.has(verb)) {
    if (topic === "style") {
      return "prefers_response_style";
    }
    if (topic === "charset") {
      return "prefers_output_charset";
    }
    return `prefers_${topic}`;
  }
  return null;
}

export function canonicalizePreferenceHint(
  hint: MemoryCandidatePreferenceHint | null | undefined,
): MemoryCandidatePreferenceHint | null {
  if (!hint) {
    return null;
  }
  const predicate = canonicalizePreferencePredicate(hint.predicate);
  if (!predicate || !hint.object.trim()) {
    return null;
  }
  return {
    ...hint,
    predicate,
    object: hint.object.trim(),
    reason: hint.reason?.trim() || undefined,
  };
}

export function parseWorkflowState(
  text: string,
): { key: string; value: Record<string, unknown> } | null {
  const judgment = judgeWorkflowState(text);
  if (!judgment) {
    return null;
  }
  return {
    key: judgment.key,
    value: judgment.value,
  };
}

function decisionConfidence(text: string): MemoryCandidateDecisionHint | null {
  const stripped = stripLead(text);
  if (
    !stripped ||
    isLowValueChatter(stripped) ||
    isQuestionLike(stripped) ||
    parseRelation(stripped)
  ) {
    return null;
  }

  const preference = judgePreferenceSignal(stripped);
  const workflow = judgeWorkflowState(stripped);
  const correction = analyzeCorrectionHint({ text: stripped });
  const durableInstructionCue =
    /\b(?:must use|always use|never use|default to|stick with|we are going with|from now on|keep using)\b/iu.test(
      stripped,
    ) ||
    /(?:必须用|只能用|默认(?:改成|设为|采用|用)?|以后(?:都)?用|今后(?:都)?用|统一用|固定用|记着(?:以后)?|优先按这个顺序)/u.test(
      stripped,
    );
  const explicitDecision =
    durableInstructionCue ||
    /\b(?:we decided(?: to)?|decision is|constraint is)\b/iu.test(stripped) ||
    /(?:决定(?:用|采用|改用|选用)?|约束(?:是|为)?)/u.test(stripped);
  const defaultedPreference =
    Boolean(preference) &&
    (/\b(?:default|defaults?)\b/iu.test(stripped) ||
      /(?:默认|以后(?:都)?|今后|后面都)/u.test(stripped));
  const timeHintCount = extractTimeHints(stripped).length;
  const longAnalyticalNarrative = stripped.length > 140 || timeHintCount > 0;
  const historicalNarrativeCue =
    /(?:之前|后来|最早|第一次|上次|last time|earlier|before|initially)/iu.test(stripped) ||
    timeHintCount > 0;

  if (
    (!explicitDecision && !defaultedPreference) ||
    correction ||
    historicalNarrativeCue ||
    (longAnalyticalNarrative && !durableInstructionCue && !defaultedPreference)
  ) {
    return null;
  }

  let confidence = explicitDecision ? 0.74 : 0.62;
  if (preference) {
    confidence += 0.08;
  }
  if (workflow) {
    confidence += 0.06;
  }

  return {
    summary: stripped,
    confidence: Math.min(0.92, confidence),
    reason: explicitDecision
      ? "explicit decision or constraint language"
      : "defaulted preference decision",
  };
}

export function analyzeSemanticHints(text: string): SemanticHintSummary {
  const preference = canonicalizePreferenceHint(judgePreferenceSignal(text));
  const workflow = judgeWorkflowState(text);
  const relation = judgeRelationHint(text);
  const relations = judgeAllRelationHints(text);
  const decision = decisionConfidence(text);
  const correction = analyzeCorrectionHint({
    text,
    canonicalKey: workflow?.key,
    predicate:
      (relation?.predicate === "related_to" && relation.rawPredicate ? relation.rawPredicate : undefined) ??
      relation?.predicate ??
      preference?.predicate,
  });
  return {
    entities: inferEntityNames(text),
    timeHints: extractTimeHints(text),
    preference,
    workflow,
    workflows: workflow ? [workflow] : [],
    relation,
    relations,
    decision,
    correction,
  };
}

export function hasPreferenceHint(text: string): boolean {
  return analyzeSemanticHints(text).preference !== null;
}

export function hasTaskStateHint(text: string): boolean {
  return analyzeSemanticHints(text).workflow !== null;
}

export function hasRelationHint(text: string): boolean {
  return analyzeSemanticHints(text).relation !== null;
}

export function hasDecisionHint(text: string): boolean {
  return analyzeSemanticHints(text).decision !== null;
}

export function analyzeQueryShape(query: string): RecallQueryShape {
  return analyzeRecallQueryShape(query);
}
