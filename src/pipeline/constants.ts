/**
 * Pipeline scoring constants.
 *
 * Extracted from policy.ts, beliefAggregation.ts, turnScheduler.ts, and
 * index.ts so tunable weights, thresholds, and capacity caps live in one
 * place instead of being scattered as unnamed numeric literals.
 *
 * Naming convention: DOMAIN_SCOPE_PARAM (e.g. SALIENCE_EXPLICIT_INTENT).
 * Grouped by originating domain.
 */

// ---------------------------------------------------------------------------
// Policy — utility score weights (policy.ts → utilityScore)
// ---------------------------------------------------------------------------
export const UTILITY_BASE = 0.16;
export const UTILITY_PREFERENCE_HINT = 0.26;
export const UTILITY_PREFERENCE = 0.18;
export const UTILITY_DECISION_HINT = 0.24;
export const UTILITY_WORKFLOW_HINT = 0.18;
export const UTILITY_WORKFLOW = 0.14;
export const UTILITY_RELATION_HINT = 0.42;
export const UTILITY_TOOL_SOURCE = 0.12;
export const UTILITY_TEMPORAL_PATTERN = 0.12;
export const UTILITY_IMPORTANT_EVENT = 0.16;
export const UTILITY_FACT_OR_RELATION = 0.12;

// ---------------------------------------------------------------------------
// Policy — salience score weights (policy.ts → salienceScore)
// ---------------------------------------------------------------------------
export const SALIENCE_BASE = 0.16;
export const SALIENCE_EXPLICIT_INTENT = 0.38;
export const SALIENCE_PREFERENCE_HINT = 0.4;
export const SALIENCE_PREFERENCE = 0.24;
export const SALIENCE_DECISION_HINT = 0.28;
export const SALIENCE_WORKFLOW_HINT = 0.24;
export const SALIENCE_WORKFLOW = 0.14;
export const SALIENCE_RELATION_HINT = 0.46;
export const SALIENCE_TOOL_SOURCE = 0.18;
export const SALIENCE_TEMPORAL_PATTERN = 0.18;
export const SALIENCE_IMPORTANT_EVENT = 0.14;
export const SALIENCE_STABLE_FACT = 0.18;
export const SALIENCE_WORKFLOW_PATTERN = 0.1;
export const SALIENCE_EXTRA_RELATION = 0.1;
export const SALIENCE_LOW_VALUE_PENALTY = 0.4;
export const SALIENCE_SHORT_TEXT_PENALTY = 0.08;

// ---------------------------------------------------------------------------
// Policy — stability score weights (policy.ts → stabilityScore)
// ---------------------------------------------------------------------------
export const STABILITY_BASE = 0.2;
export const STABILITY_PROFILE_OR_PREFERENCE = 0.3;
export const STABILITY_PREFERENCE = 0.12;
export const STABILITY_RELATION_HINT = 0.25;
export const STABILITY_WORKFLOW_PATTERN = 0.12;
export const STABILITY_WORKFLOW = 0.08;
export const STABILITY_TOOL_PENALTY = 0.08;
export const STABILITY_TEMPORAL_PENALTY = 0.08;

// ---------------------------------------------------------------------------
// Policy — repetition boost (policy.ts → repetitionBoost)
// ---------------------------------------------------------------------------
export const REPETITION_BOOST_MAX = 0.2;
export const REPETITION_BOOST_LOG_SCALE = 0.08;

// ---------------------------------------------------------------------------
// Policy — sensitivity adjustments (policy.ts → finalizeDecision)
// ---------------------------------------------------------------------------
export const SENSITIVITY_SENSITIVE_VALUE_BOOST = 0.15;
export const SENSITIVITY_PROMPT_INJECTION_BOOST = 0.8;

// ---------------------------------------------------------------------------
// Policy — fallback min salience for episodic route
// ---------------------------------------------------------------------------
export const EPISODIC_MIN_SALIENCE_FALLBACK = 0.35;

// ---------------------------------------------------------------------------
// Policy — default scores per action (policy.ts → defaultScoresForAction)
// ---------------------------------------------------------------------------
export const DEFAULT_SCORES = {
  durable_state: { salience: 0.76, utility: 0.68, stability: 0.74 },
  session_state: { salience: 0.58, utility: 0.54, stability: 0.46 },
  stable_fact: { salience: 0.82, utility: 0.8, stability: 0.86 },
  graph_relation: { salience: 0.78, utility: 0.84, stability: 0.72 },
  episodic_event: { salience: 0.62, utility: 0.52, stability: 0.36 },
  fallback: { salience: 0.14, utility: 0.08, stability: 0.1 },
} as const;

// ---------------------------------------------------------------------------
// Belief aggregation — source reliability (beliefAggregation.ts)
// ---------------------------------------------------------------------------
export const SOURCE_RELIABILITY = {
  tool: 0.95,
  user: 0.82,
  assistant: 0.56,
  synthesized: 0.68,
  default: 0.64,
} as const;

// ---------------------------------------------------------------------------
// Belief aggregation — fallback prior confidence per memory kind
// ---------------------------------------------------------------------------
export const FALLBACK_PRIOR_CONFIDENCE = {
  state: 0.7,
  task: 0.66,
  fact: 0.76,
  event: 0.62,
  graph_edge: 0.68,
  chunk: 0.44,
  strategy: 0.5,
} as const;

// ---------------------------------------------------------------------------
// Belief aggregation — fallback source reliability per memory kind
// ---------------------------------------------------------------------------
export const FALLBACK_SOURCE_RELIABILITY = {
  chunk: 0.52,
  task: 0.72,
  strategy: 0.58,
  default: 0.7,
} as const;

// ---------------------------------------------------------------------------
// Belief aggregation — posterior confidence weights
// ---------------------------------------------------------------------------
export const POSTERIOR_USEFULNESS_WEIGHT = 0.3;
export const POSTERIOR_STABILITY_WEIGHT = 0.15;
export const POSTERIOR_OUTCOME_WEIGHT = 0.15;
export const POSTERIOR_CONSISTENCY_WEIGHT = 0.1;
export const POSTERIOR_TEMPORAL_WEIGHT = 0.08;
export const POSTERIOR_PROMOTION_WEIGHT = 0.05;
export const POSTERIOR_CONTRADICTION_WEIGHT = 0.35;
export const POSTERIOR_DEMOTION_WEIGHT = 0.15;
export const POSTERIOR_CORRECTION_WEIGHT = 0.26;
export const POSTERIOR_REPEATED_USE_WEIGHT = 0.08;
export const POSTERIOR_STALE_DECAY_WEIGHT = 0.12;
export const POSTERIOR_MIDPOINT = 0.5;

// ---------------------------------------------------------------------------
// Turn scheduler — operational limits (turnScheduler.ts)
// ---------------------------------------------------------------------------
export const SCHEDULER_RECENT_TASKS_LIMIT = 6;
export const SCHEDULER_RECENT_ACTIVE_LIMIT = 12;
export const SCHEDULER_DEDUP_PROBE_SCALE = 0.55;
export const SCHEDULER_DEDUP_PROBE_FLOOR = 0.46;
export const SCHEDULER_DEDUP_LEXICAL_FLOOR = 0.34;
export const SCHEDULER_DEDUP_STRONG_SEMANTIC_FLOOR = 0.74;
export const SCHEDULER_SUMMARY_SCORE_BOOST = 1.04;
export const SCHEDULER_CANDIDATE_POOL_SIZE = 5;
export const SCHEDULER_CONTEXT_CHUNKS = 4;
export const SCHEDULER_TRUNCATE_TEXT = 220;
export const SCHEDULER_TRUNCATE_VECTOR_TEXT = 500;

// ---------------------------------------------------------------------------
// Turn scheduler — vector doc confidence values
// ---------------------------------------------------------------------------
export const CHUNK_VECTOR_CONFIDENCE = 0.88;
export const TASK_VECTOR_CONFIDENCE = 0.9;

// ---------------------------------------------------------------------------
// Index — prompt budget & suppression
// ---------------------------------------------------------------------------
export const MIN_PROMPT_BUDGET = 400;
export const SUPPRESSION_CHECK_LENGTH = 96;

// ---------------------------------------------------------------------------
// Memory objects — collection limits
// ---------------------------------------------------------------------------
export const BEHAVIORAL_GUIDANCE_LIMIT = 5;
export const STRATEGY_GUIDANCE_LIMIT = 3;
export const BACKGROUND_ACTIVE_TASKS_LIMIT = 3;
export const BACKGROUND_STATE_ROWS_LIMIT = 5;
export const STRATEGY_MIN_CONFIDENCE = 0.76;
export const STRATEGY_MAX_CONTRADICTION = 0.4;
