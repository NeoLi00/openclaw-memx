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
export declare const UTILITY_BASE = 0.16;
export declare const UTILITY_PREFERENCE_HINT = 0.26;
export declare const UTILITY_PREFERENCE = 0.18;
export declare const UTILITY_DECISION_HINT = 0.24;
export declare const UTILITY_WORKFLOW_HINT = 0.18;
export declare const UTILITY_WORKFLOW = 0.14;
export declare const UTILITY_RELATION_HINT = 0.42;
export declare const UTILITY_TOOL_SOURCE = 0.12;
export declare const UTILITY_TEMPORAL_PATTERN = 0.12;
export declare const UTILITY_IMPORTANT_EVENT = 0.16;
export declare const UTILITY_FACT_OR_RELATION = 0.12;
export declare const SALIENCE_BASE = 0.16;
export declare const SALIENCE_EXPLICIT_INTENT = 0.38;
export declare const SALIENCE_PREFERENCE_HINT = 0.4;
export declare const SALIENCE_PREFERENCE = 0.24;
export declare const SALIENCE_DECISION_HINT = 0.28;
export declare const SALIENCE_WORKFLOW_HINT = 0.24;
export declare const SALIENCE_WORKFLOW = 0.14;
export declare const SALIENCE_RELATION_HINT = 0.46;
export declare const SALIENCE_TOOL_SOURCE = 0.18;
export declare const SALIENCE_TEMPORAL_PATTERN = 0.18;
export declare const SALIENCE_IMPORTANT_EVENT = 0.14;
export declare const SALIENCE_STABLE_FACT = 0.18;
export declare const SALIENCE_WORKFLOW_PATTERN = 0.1;
export declare const SALIENCE_EXTRA_RELATION = 0.1;
export declare const SALIENCE_LOW_VALUE_PENALTY = 0.4;
export declare const SALIENCE_SHORT_TEXT_PENALTY = 0.08;
export declare const STABILITY_BASE = 0.2;
export declare const STABILITY_PROFILE_OR_PREFERENCE = 0.3;
export declare const STABILITY_PREFERENCE = 0.12;
export declare const STABILITY_RELATION_HINT = 0.25;
export declare const STABILITY_WORKFLOW_PATTERN = 0.12;
export declare const STABILITY_WORKFLOW = 0.08;
export declare const STABILITY_TOOL_PENALTY = 0.08;
export declare const STABILITY_TEMPORAL_PENALTY = 0.08;
export declare const REPETITION_BOOST_MAX = 0.2;
export declare const REPETITION_BOOST_LOG_SCALE = 0.08;
export declare const SENSITIVITY_SENSITIVE_VALUE_BOOST = 0.15;
export declare const SENSITIVITY_PROMPT_INJECTION_BOOST = 0.8;
export declare const EPISODIC_MIN_SALIENCE_FALLBACK = 0.35;
export declare const DEFAULT_SCORES: {
    readonly durable_state: {
        readonly salience: 0.76;
        readonly utility: 0.68;
        readonly stability: 0.74;
    };
    readonly session_state: {
        readonly salience: 0.58;
        readonly utility: 0.54;
        readonly stability: 0.46;
    };
    readonly stable_fact: {
        readonly salience: 0.82;
        readonly utility: 0.8;
        readonly stability: 0.86;
    };
    readonly graph_relation: {
        readonly salience: 0.78;
        readonly utility: 0.84;
        readonly stability: 0.72;
    };
    readonly episodic_event: {
        readonly salience: 0.62;
        readonly utility: 0.52;
        readonly stability: 0.36;
    };
    readonly fallback: {
        readonly salience: 0.14;
        readonly utility: 0.08;
        readonly stability: 0.1;
    };
};
export declare const SOURCE_RELIABILITY: {
    readonly tool: 0.95;
    readonly user: 0.82;
    readonly assistant: 0.56;
    readonly synthesized: 0.68;
    readonly default: 0.64;
};
export declare const FALLBACK_PRIOR_CONFIDENCE: {
    readonly state: 0.7;
    readonly task: 0.66;
    readonly fact: 0.76;
    readonly event: 0.62;
    readonly graph_edge: 0.68;
    readonly chunk: 0.44;
    readonly strategy: 0.5;
};
export declare const FALLBACK_SOURCE_RELIABILITY: {
    readonly chunk: 0.52;
    readonly task: 0.72;
    readonly strategy: 0.58;
    readonly default: 0.7;
};
export declare const POSTERIOR_USEFULNESS_WEIGHT = 0.3;
export declare const POSTERIOR_STABILITY_WEIGHT = 0.15;
export declare const POSTERIOR_OUTCOME_WEIGHT = 0.15;
export declare const POSTERIOR_CONSISTENCY_WEIGHT = 0.1;
export declare const POSTERIOR_TEMPORAL_WEIGHT = 0.08;
export declare const POSTERIOR_PROMOTION_WEIGHT = 0.05;
export declare const POSTERIOR_CONTRADICTION_WEIGHT = 0.35;
export declare const POSTERIOR_DEMOTION_WEIGHT = 0.15;
export declare const POSTERIOR_CORRECTION_WEIGHT = 0.26;
export declare const POSTERIOR_REPEATED_USE_WEIGHT = 0.08;
export declare const POSTERIOR_STALE_DECAY_WEIGHT = 0.12;
export declare const POSTERIOR_MIDPOINT = 0.5;
export declare const SCHEDULER_RECENT_TASKS_LIMIT = 6;
export declare const SCHEDULER_RECENT_ACTIVE_LIMIT = 12;
export declare const SCHEDULER_DEDUP_PROBE_SCALE = 0.55;
export declare const SCHEDULER_DEDUP_PROBE_FLOOR = 0.46;
export declare const SCHEDULER_DEDUP_LEXICAL_FLOOR = 0.34;
export declare const SCHEDULER_DEDUP_STRONG_SEMANTIC_FLOOR = 0.74;
export declare const SCHEDULER_SUMMARY_SCORE_BOOST = 1.04;
export declare const SCHEDULER_CANDIDATE_POOL_SIZE = 5;
export declare const SCHEDULER_CONTEXT_CHUNKS = 4;
export declare const SCHEDULER_TRUNCATE_TEXT = 220;
export declare const SCHEDULER_TRUNCATE_VECTOR_TEXT = 500;
export declare const CHUNK_VECTOR_CONFIDENCE = 0.88;
export declare const TASK_VECTOR_CONFIDENCE = 0.9;
export declare const MIN_PROMPT_BUDGET = 400;
export declare const SUPPRESSION_CHECK_LENGTH = 96;
export declare const BEHAVIORAL_GUIDANCE_LIMIT = 5;
export declare const STRATEGY_GUIDANCE_LIMIT = 3;
export declare const BACKGROUND_ACTIVE_TASKS_LIMIT = 3;
export declare const BACKGROUND_STATE_ROWS_LIMIT = 5;
export declare const STRATEGY_MIN_CONFIDENCE = 0.76;
export declare const STRATEGY_MAX_CONTRADICTION = 0.4;
