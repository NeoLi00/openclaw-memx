export const MEMORY_ROUTE_TYPES = [
    "workflow",
    "factual",
    "explanatory",
    "temporal",
    "mixed",
    "unknown",
];
export const MEMORY_CORRECTION_TIMEFRAMES = ["current", "historical", "compare"];
export const MEMORY_CORRECTION_TARGET_KINDS = [
    "state",
    "fact",
    "relation",
    "project_profile",
    "unknown",
];
export const RECALL_QUERY_TIMEFRAMES = ["current", "historical", "compare", "timeless"];
export const RECALL_QUERY_GRANULARITIES = ["summary", "exact_detail"];
export const RECALL_QUERY_REFERENTIAL_MODES = ["anchored", "deictic"];
export const RECALL_QUERY_EVIDENCE_NEEDS = [
    "workflow_context",
    "canonical_state",
    "factual_history",
    "event_history",
    "relation",
    "chunk",
];
export const TURN_MODES = ["memory_qa", "workspace_task", "mixed"];
export const RECALL_NEED_LEVELS = ["none", "background_only", "shallow", "full"];
export const WORKING_PROJECTION_ROLES = [
    "user_style",
    "active_task",
    "active_blocker",
    "validated_strategy",
    "open_risk",
];
export const MEMORY_ACTIONS = [
    "ignore",
    "session_state",
    "durable_state",
    "stable_fact",
    "episodic_event",
    "graph_relation",
];
export const MEMORY_SIGNAL_TYPES = [
    "self_consistency",
    "retrieval_support",
    "future_usefulness",
    "outcome_feedback",
    "contradiction",
    "temporal_stability",
    "assistant_grounding",
    "demotion",
    "promotion",
    "correction",
    "repeated_use",
    "stale_decay",
];
export const MEMORY_SIGNAL_TARGET_KINDS = [
    "state",
    "task",
    "fact",
    "event",
    "graph_edge",
    "chunk",
];
export const MEMORY_BELIEF_STAGES = [
    "candidate",
    "probationary",
    "active",
    "decaying",
    "superseded",
    "quarantined",
];
export const ABSTRACTION_CANDIDATE_TYPES = [
    "derived_state",
    "workflow_pattern",
    "concept_candidate",
    "graph_hypothesis",
    "outcome_hypothesis",
];
export const ABSTRACTION_CANDIDATE_STAGES = MEMORY_BELIEF_STAGES;
export const STRATEGY_HYPOTHESIS_STAGES = [
    "candidate",
    "active",
    "superseded",
    "quarantined",
];
export const MEMORY_BELIEF_KINDS = [...MEMORY_SIGNAL_TARGET_KINDS, "strategy"];
export const GRAPH_RELATION_TYPES = [
    "depends_on",
    "blocks",
    "caused_by",
    "uses",
    "part_of",
    "owner_of",
    "supersedes",
    "contradicts",
    "resolved_by",
    "related_to",
    "reads",
];
export const GRAPH_SUPPORT_RELATION_TYPES = [
    "supported_by",
    "derived_from",
    "updates",
    "targets",
];
export const ENTITY_TYPES = [
    "person",
    "project",
    "tool",
    "service",
    "language",
    "framework",
    "concept",
    "organization",
    "unknown",
];
export const GRAPH_NODE_KINDS = ["entity", "task", "state", "fact", "event", "outcome"];
export const MEMORY_CLASSES = [
    "current-state",
    "stable-fact",
    "episodic-event",
    "graph-worthy",
    "ignore",
];
export const MEMORY_SOURCE_KINDS = ["user", "assistant", "tool"];
export const MEMORY_SCOPE_TEMPLATES = [
    "global",
    "agent:{agentId}",
    "session:{sessionKey}",
    "project:{project}",
];
export const MEMORY_PII_MODES = ["off", "redact", "allow"];
export const MEMORY_CONSENT_MODES = ["explicit", "implicit", "off"];
export const MEMORY_EMBEDDING_PROVIDERS = [
    "off",
    "openai-compatible",
    "ollama",
    "sentence-transformers-local",
];
export const MEMX_STATE_LIFECYCLE_KINDS = [
    "durable_profile",
    "session_working",
    "transient_blocker",
    "transient_next_step",
    "derived_maintenance",
    "task_checkpoint",
];
export const MEMORY_OBJECT_KINDS = [
    "state",
    "task",
    "fact",
    "event",
    "graph_path",
    "chunk",
    "alternate",
];
