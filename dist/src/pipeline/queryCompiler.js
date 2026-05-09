import { clamp01, normalizeText, normalizedTerms } from "../support.js";
import { recordMemoryLlmBudgetCall } from "./llmBudgetAudit.js";
import { analyzeQueryShape, extractQueryAnchors } from "./semantics.js";
const PRIMARY_ROUTE_TYPES = [
    "workflow",
    "factual",
    "temporal",
    "explanatory",
];
const VALID_CANDIDATE_SURFACES = [
    "state",
    "fact",
    "event",
    "task",
    "chunk",
    "graph",
    "entity_alias",
];
const VALID_EVIDENCE_PLAN_LAYERS = [
    ...VALID_CANDIDATE_SURFACES,
    "control",
    "strategy",
    "abstraction",
    "belief",
    "snippet",
];
const VALID_EVIDENCE_SLOT_ROLES = [
    "query_context",
    "answer_evidence",
    "answer_value",
    "answer_event",
    "time_constraint",
    "user_resource",
    "prior_advice",
    "supporting_context",
];
const QUERY_COMPILER_CUTOVER_CRITERIA = {
    invariantRegressionMustBeZero: true,
    deterministicFallbackRateMax: 0.02,
    outputDiffRateMax: 0.1,
    explainableDiffRateMin: 0.9,
    requiredScenes: ["snapshot", "compare", "deictic", "exact_detail", "correction"],
};
function normalizeRouteWeights(weights) {
    const total = PRIMARY_ROUTE_TYPES.reduce((sum, routeType) => sum + Math.max(0, weights[routeType] ?? 0), 0);
    if (total <= 0) {
        return {};
    }
    return Object.fromEntries(PRIMARY_ROUTE_TYPES.map((routeType) => [routeType, clamp01((weights[routeType] ?? 0) / total)]));
}
function computeTurnMode(query, queryShape) {
    if (queryShape.timeframe !== "timeless" ||
        queryShape.granularity === "exact_detail" ||
        queryShape.evidenceNeed !== "canonical_state") {
        return "memory_qa";
    }
    return queryShape.referentialMode === "anchored" && normalizeText(query).length >= 12
        ? "memory_qa"
        : "mixed";
}
function deriveAnswerGranularity(queryShape) {
    if (queryShape.granularity === "exact_detail") {
        return "detail";
    }
    return "summary";
}
function deriveEvidenceFidelity(queryShape, anchors) {
    if (queryShape.timeframe === "compare" || queryShape.granularity === "exact_detail") {
        return "high";
    }
    if (queryShape.timeframe === "historical" ||
        anchors.length === 0 ||
        queryShape.referentialMode === "deictic") {
        return "medium";
    }
    return "low";
}
function deriveRouteWeights(queryShape) {
    const rawWeights = {
        workflow: 0.08,
        factual: 0.08,
        temporal: 0.08,
        explanatory: 0.08,
    };
    switch (queryShape.evidenceNeed) {
        case "workflow_context":
            rawWeights.workflow += 0.62;
            break;
        case "canonical_state":
            rawWeights.factual += 0.56;
            break;
        case "factual_history":
            rawWeights.factual += 0.44;
            rawWeights.temporal += 0.22;
            break;
        case "event_history":
            rawWeights.temporal += 0.56;
            rawWeights.factual += 0.16;
            break;
        case "relation":
            rawWeights.explanatory += 0.48;
            rawWeights.factual += 0.16;
            break;
        case "chunk":
            rawWeights.temporal += 0.28;
            rawWeights.factual += 0.28;
            break;
    }
    if (queryShape.timeframe === "current") {
        rawWeights.factual += 0.32;
    }
    else if (queryShape.timeframe === "historical") {
        rawWeights.temporal += 0.32;
    }
    else if (queryShape.timeframe === "compare") {
        rawWeights.temporal += 0.3;
        rawWeights.factual += 0.3;
    }
    if (queryShape.referentialMode === "deictic") {
        rawWeights.workflow += 0.14;
    }
    if (queryShape.granularity === "exact_detail") {
        rawWeights.temporal += 0.12;
        rawWeights.factual += 0.12;
    }
    return normalizeRouteWeights(rawWeights);
}
function deriveCandidateSurfaces(queryShape, answerGranularity, evidenceFidelity) {
    const surfaces = new Set();
    switch (queryShape.evidenceNeed) {
        case "workflow_context":
            surfaces.add("task");
            surfaces.add("state");
            surfaces.add("chunk");
            break;
        case "canonical_state":
            surfaces.add("state");
            surfaces.add("fact");
            break;
        case "factual_history":
            surfaces.add("fact");
            surfaces.add("event");
            surfaces.add("chunk");
            break;
        case "event_history":
            surfaces.add("event");
            surfaces.add("chunk");
            break;
        case "relation":
            surfaces.add("graph");
            surfaces.add("entity_alias");
            surfaces.add("fact");
            break;
        case "chunk":
            surfaces.add("chunk");
            surfaces.add("event");
            break;
    }
    if (queryShape.timeframe === "current") {
        surfaces.add("state");
        surfaces.add("fact");
    }
    if (queryShape.timeframe === "historical" || queryShape.timeframe === "compare") {
        surfaces.add("event");
        surfaces.add("fact");
    }
    if (answerGranularity === "detail" || evidenceFidelity === "high") {
        surfaces.add("chunk");
    }
    if (queryShape.referentialMode === "deictic") {
        surfaces.add("task");
    }
    if (queryShape.referentialMode === "anchored") {
        surfaces.add("event");
        surfaces.add("chunk");
    }
    if (queryShape.evidenceNeed === "workflow_context") {
        surfaces.add("fact");
        surfaces.add("event");
    }
    return [...surfaces];
}
function uniqueNonEmpty(values, limit = 8) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed) {
            continue;
        }
        const key = normalizeText(trimmed);
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(trimmed);
        if (result.length >= limit) {
            break;
        }
    }
    return result;
}
function normalizeCompilerHint(value) {
    const cleaned = value.replace(/\s+/gu, " ").trim();
    const normalized = normalizeText(cleaned);
    if (!normalized) {
        return "";
    }
    return cleaned;
}
function usefulQueryHint(value) {
    const normalized = normalizeText(value);
    if (!normalized || /^question$/iu.test(normalized)) {
        return false;
    }
    if (/^question\s*:/iu.test(value.trim())) {
        return false;
    }
    return normalizedTerms(normalized, { minLength: 2 }).length > 0;
}
function usefulQueryHints(values, limit = 8) {
    return uniqueNonEmpty(values.map(normalizeCompilerHint).filter((hint) => hint && usefulQueryHint(hint)), limit);
}
function meaningfulQueryTerms(query) {
    return uniqueNonEmpty([normalizeCompilerHint(query), ...extractQueryAnchors(query).map(normalizeCompilerHint)].filter(usefulQueryHint), 8);
}
function deriveAnswerMode(query, queryShape) {
    void query;
    if (queryShape.timeframe === "compare" || queryShape.evidenceNeed === "relation") {
        return "multi_evidence";
    }
    return "single_fact";
}
function sanitizeAnswerMode(value, query, queryShape) {
    void query;
    return value === "single_fact" ||
        value === "attribute_lookup" ||
        value === "count_aggregate" ||
        value === "multi_evidence"
        ? value
        : deriveAnswerMode(query, queryShape);
}
function deriveTopicAnchors(query, mode, anchors) {
    void mode;
    const cleanedAnchors = usefulQueryHints(anchors);
    return uniqueNonEmpty([...cleanedAnchors, ...meaningfulQueryTerms(query)], 4);
}
function deriveEvidenceCoverage(params) {
    const topicAnchors = deriveTopicAnchors(params.query, params.answerMode, params.anchors);
    const optionalAnchors = uniqueNonEmpty([...meaningfulQueryTerms(params.query), ...topicAnchors], 6);
    const [minProtectedItems, maxProtectedItems] = params.answerMode === "count_aggregate"
        ? [2, 4]
        : params.answerMode === "multi_evidence"
            ? [2, 3]
            : [1, 1];
    return {
        requiredAnchors: [],
        optionalAnchors,
        minProtectedItems,
        maxProtectedItems,
    };
}
function sanitizeEvidenceCoverage(query, compiled) {
    const answerMode = compiled.answerMode ?? deriveAnswerMode(query, compiled.queryShape);
    const fallback = deriveEvidenceCoverage({
        query,
        queryShape: compiled.queryShape,
        anchors: compiled.anchors,
        answerMode,
    });
    const input = compiled.evidenceCoverage;
    if (!input) {
        return fallback;
    }
    const rawRequiredAnchors = uniqueNonEmpty((Array.isArray(input.requiredAnchors) ? input.requiredAnchors : [])
        .map(normalizeCompilerHint)
        .filter(usefulQueryHint), 6);
    const optionalAnchors = uniqueNonEmpty((Array.isArray(input.optionalAnchors) ? input.optionalAnchors : [])
        .map(normalizeCompilerHint)
        .filter(usefulQueryHint), 6);
    const requiredAnchors = rawRequiredAnchors.length > 0 ? rawRequiredAnchors : fallback.requiredAnchors;
    return {
        requiredAnchors,
        optionalAnchors: optionalAnchors.length > 0 ? optionalAnchors : fallback.optionalAnchors,
        minProtectedItems: typeof input.minProtectedItems === "number" && Number.isFinite(input.minProtectedItems)
            ? Math.max(0, Math.min(4, Math.floor(input.minProtectedItems)))
            : fallback.minProtectedItems,
        maxProtectedItems: typeof input.maxProtectedItems === "number" && Number.isFinite(input.maxProtectedItems)
            ? Math.max(1, Math.min(4, Math.floor(input.maxProtectedItems)))
            : fallback.maxProtectedItems,
    };
}
function buildDefaultEvidenceGoals(params) {
    const focusedQuery = params.focusedQuery.trim();
    const anchors = uniqueNonEmpty([
        ...(params.evidenceCoverage?.optionalAnchors ?? []),
        ...params.anchors.map(normalizeCompilerHint),
    ].filter(usefulQueryHint), 6);
    const anchorQuery = anchors.join(" ").trim();
    const positiveQueries = uniqueNonEmpty([
        focusedQuery,
        anchorQuery && focusedQuery ? `${anchorQuery} ${focusedQuery}` : "",
        anchorQuery,
    ], 4);
    return [
        {
            goal: `Find remembered evidence that answers: ${focusedQuery || anchorQuery || "the current query"}`,
            positiveQueries: positiveQueries.length > 0
                ? positiveQueries
                : [focusedQuery || anchorQuery || "memory evidence"],
            focusAnchors: [],
            preferredSurfaces: params.candidateSurfaces,
            fidelity: params.evidenceFidelity,
        },
    ];
}
function normalizePlanLayers(layers, fallbackLayers, limit = 12) {
    if (!Array.isArray(layers)) {
        return fallbackLayers;
    }
    const valid = layers.filter((layer) => VALID_EVIDENCE_PLAN_LAYERS.includes(layer));
    return valid.length > 0 ? [...new Set(valid)].slice(0, limit) : fallbackLayers;
}
function normalizeBridgePreferredLayers(layers, fallbackLayers, operation) {
    const normalized = normalizePlanLayers(layers, fallbackLayers);
    const withRawEvidence = [...normalized];
    const add = (layer) => {
        if (!withRawEvidence.includes(layer)) {
            withRawEvidence.push(layer);
        }
    };
    add("chunk");
    if (operation === "aggregate") {
        add("event");
    }
    return withRawEvidence.slice(0, 12);
}
function defaultPreferredLayers(params) {
    const layers = [];
    const add = (layer) => {
        if (!layers.includes(layer)) {
            layers.push(layer);
        }
    };
    if (params.queryShape.evidenceNeed === "relation") {
        add("graph");
        add("entity_alias");
    }
    if (params.queryShape.timeframe === "current") {
        add("state");
    }
    for (const surface of params.candidateSurfaces) {
        add(surface);
    }
    if (!layers.includes("event")) {
        add("event");
    }
    if (!layers.includes("chunk")) {
        add("chunk");
    }
    return layers.slice(0, 12);
}
function defaultFallbackLayers(preferredLayers) {
    const fallback = new Set(preferredLayers);
    fallback.add("fact");
    fallback.add("event");
    fallback.add("chunk");
    fallback.add("snippet");
    return [...fallback].slice(0, 12);
}
function requiredFieldsForPlan(params) {
    void params.query;
    if (params.answerMode === "attribute_lookup") {
        return ["attribute_value"];
    }
    if (params.answerMode === "count_aggregate") {
        return ["countable_item"];
    }
    if (params.queryShape.timeframe === "compare") {
        return ["temporal_marker"];
    }
    if (params.queryShape.granularity === "exact_detail") {
        return ["answer_value"];
    }
    return [];
}
const BRIDGE_TEMPLATE_NOISE = new Set([
    "requested topic or domain",
    "query context",
    "matching event or item",
    "count target",
    "event evidence",
    "time constraint from query",
    "temporal marker",
    "source evidence",
    "direct answer value",
    "requested attribute value",
    "topic or domain that the historical answer must be about",
]);
function meaningfulContractHint(value, _params) {
    const normalized = normalizeText(value);
    if (!retrievalHintAllowed(normalized)) {
        return false;
    }
    if (BRIDGE_TEMPLATE_NOISE.has(normalized)) {
        return false;
    }
    return true;
}
function compactEvidenceContractHints(values, params) {
    return uniqueNonEmpty(values.map(normalizeCompilerHint).filter((value) => meaningfulContractHint(value, params)), params.limit);
}
function operationTypeForPlan(params) {
    void params.query;
    if (params.answerMode === "count_aggregate") {
        return {
            type: "aggregate",
            description: "Count or aggregate only evidence that fills the requested slots.",
        };
    }
    if (params.queryShape.timeframe === "compare") {
        return {
            type: "derive",
            description: "Compare or derive the answer only after the relevant slots are filled.",
        };
    }
    if (params.queryShape.evidenceNeed === "relation") {
        return {
            type: "relate",
            description: "Use relation evidence and source evidence together; graph-only support is not final proof.",
        };
    }
    return {
        type: "return_value",
        description: "Return the value directly supported by filled evidence slots.",
    };
}
const VALID_EVIDENCE_OPERATION_TYPES = [
    "return_value",
    "aggregate",
    "derive",
    "compare",
    "relate",
    "tailor_advice",
];
function sanitizeEvidenceOperationType(value, fallback) {
    if (typeof value !== "string") {
        return fallback;
    }
    const normalized = normalizeText(value).replace(/\s+/gu, "_");
    return VALID_EVIDENCE_OPERATION_TYPES.includes(normalized)
        ? normalized
        : fallback;
}
function splitComparisonAnchors(query, anchors) {
    void query;
    const cleaned = anchors.map(normalizeCompilerHint).filter(Boolean);
    return cleaned.length >= 2 ? cleaned.slice(0, 4) : [];
}
function slotFromHints(params) {
    return {
        id: params.id,
        ...(params.role ? { role: params.role } : {}),
        description: params.description,
        subjectHints: uniqueNonEmpty(params.subjectHints.map(normalizeCompilerHint).filter(Boolean), 6),
        relationHints: uniqueNonEmpty(params.relationHints.map(normalizeCompilerHint).filter(Boolean), 6),
        capabilityQueries: uniqueNonEmpty((params.capabilityQueries ?? []).map(normalizeCompilerHint).filter(Boolean), 8),
        negativeHints: uniqueNonEmpty((params.negativeHints ?? []).map(normalizeCompilerHint).filter(Boolean), 6),
        ...(params.requiredRole ? { requiredRole: params.requiredRole } : {}),
        requiredFields: uniqueNonEmpty(params.requiredFields, 4),
        preferredLayers: params.preferredLayers,
        fallbackLayers: params.fallbackLayers,
        minEvidence: Math.max(1, Math.min(4, Math.trunc(params.minEvidence))),
    };
}
function buildDefaultEvidencePlan(params) {
    const preferredLayers = defaultPreferredLayers({
        query: params.query,
        queryShape: params.queryShape,
        candidateSurfaces: params.candidateSurfaces,
    });
    const fallbackLayers = defaultFallbackLayers(preferredLayers);
    const requiredFields = requiredFieldsForPlan({
        query: params.query,
        queryShape: params.queryShape,
        answerMode: params.answerMode,
    });
    const relationHints = [];
    const comparisonAnchors = params.queryShape.timeframe === "compare"
        ? splitComparisonAnchors(params.query, params.anchors)
        : [];
    const topicHints = uniqueNonEmpty([
        ...params.anchors,
        ...meaningfulQueryTerms(params.focusedQuery || params.query),
        ...meaningfulQueryTerms(params.query),
    ], 6);
    const slots = comparisonAnchors.length >= 2
        ? comparisonAnchors.map((anchor, index) => slotFromHints({
            id: `slot_${index + 1}`,
            role: "answer_evidence",
            description: `Evidence for ${anchor}`,
            subjectHints: [anchor],
            relationHints,
            requiredFields,
            preferredLayers,
            fallbackLayers,
            minEvidence: 1,
        }))
        : params.answerMode === "count_aggregate"
            ? [
                slotFromHints({
                    id: "answer_event",
                    role: "answer_event",
                    requiredRole: "answer_event",
                    description: `Distinct remembered events/items that should be counted for: ${params.focusedQuery || params.query}`,
                    subjectHints: topicHints,
                    relationHints: ["distinct countable event"],
                    negativeHints: ["event outside the requested count target"],
                    requiredFields: ["countable_item", "source_evidence"],
                    preferredLayers: ["event", "chunk", "fact"],
                    fallbackLayers: ["event", "chunk", "fact", "snippet"],
                    minEvidence: 2,
                }),
                slotFromHints({
                    id: "time_constraint",
                    role: "time_constraint",
                    requiredRole: "time_constraint",
                    description: "Temporal window or time constraint from the query.",
                    subjectHints: topicHints,
                    relationHints: ["temporal constraint"],
                    requiredFields: ["temporal_marker"],
                    preferredLayers: ["event", "chunk", "fact"],
                    fallbackLayers: ["event", "chunk", "snippet"],
                    minEvidence: 1,
                }),
            ]
            : params.answerMode === "attribute_lookup"
                ? [
                    slotFromHints({
                        id: "query_context",
                        role: "query_context",
                        requiredRole: "query_context",
                        description: "Subject or situation the requested attribute belongs to.",
                        subjectHints: topicHints,
                        relationHints: ["query subject", "lookup context"],
                        requiredFields: ["query_context"],
                        preferredLayers,
                        fallbackLayers,
                        minEvidence: 1,
                    }),
                    slotFromHints({
                        id: "answer_value",
                        role: "answer_value",
                        requiredRole: "answer_value",
                        description: `The attribute value that directly answers: ${params.focusedQuery || params.query}`,
                        subjectHints: topicHints,
                        relationHints: ["requested attribute value", "direct answer value"],
                        requiredFields: ["attribute_value"],
                        preferredLayers,
                        fallbackLayers,
                        minEvidence: 1,
                    }),
                ]
                : params.queryShape.timeframe === "historical"
                    ? [
                        slotFromHints({
                            id: "query_context",
                            role: "query_context",
                            requiredRole: "query_context",
                            description: "Topic or domain that the historical answer must be about.",
                            subjectHints: topicHints,
                            relationHints: ["domain context"],
                            requiredFields: ["query_context"],
                            preferredLayers,
                            fallbackLayers,
                            minEvidence: 1,
                        }),
                        slotFromHints({
                            id: "time_constraint",
                            role: "time_constraint",
                            requiredRole: "time_constraint",
                            description: "Historical time constraint from the query.",
                            subjectHints: topicHints,
                            relationHints: ["temporal constraint"],
                            requiredFields: ["temporal_marker"],
                            preferredLayers: ["event", "chunk", "fact"],
                            fallbackLayers: ["event", "chunk", "snippet"],
                            minEvidence: 1,
                        }),
                        slotFromHints({
                            id: "answer_value",
                            role: "answer_value",
                            requiredRole: "answer_value",
                            description: `The remembered value or event detail that answers: ${params.focusedQuery || params.query}`,
                            subjectHints: topicHints,
                            relationHints: ["direct answer value", "answer evidence"],
                            requiredFields: requiredFields.length > 0 ? requiredFields : ["answer_value"],
                            preferredLayers,
                            fallbackLayers,
                            minEvidence: 1,
                        }),
                    ]
                    : [
                        slotFromHints({
                            id: "query_context",
                            role: "query_context",
                            requiredRole: "query_context",
                            description: "Subject or situation the answer must be bound to.",
                            subjectHints: topicHints,
                            relationHints: ["query context", "requested subject"],
                            requiredFields: ["query_context"],
                            preferredLayers,
                            fallbackLayers,
                            minEvidence: 1,
                        }),
                        slotFromHints({
                            id: "answer_value",
                            role: "answer_value",
                            requiredRole: "answer_value",
                            description: `Evidence that can directly answer: ${params.focusedQuery || params.query}`,
                            subjectHints: topicHints,
                            relationHints,
                            requiredFields: requiredFields.length > 0 ? requiredFields : ["answer_value"],
                            preferredLayers,
                            fallbackLayers,
                            minEvidence: 1,
                        }),
                    ];
    return {
        slots,
        operation: operationTypeForPlan({
            query: params.query,
            queryShape: params.queryShape,
            answerMode: params.answerMode,
        }),
    };
}
function isAllowedGoalAnchor(anchor, fallback) {
    const normalized = normalizeText(anchor);
    if (!normalized || !usefulQueryHint(anchor)) {
        return false;
    }
    const focused = normalizeText(fallback.focusedQuery);
    const query = normalizeText(fallback.queryText);
    if (focused.includes(normalized) || query.includes(normalized)) {
        return true;
    }
    return fallback.anchors.some((candidate) => normalizeText(candidate) === normalized);
}
function normalizeGoalSurfaces(surfaces, fallbackSurfaces) {
    if (!Array.isArray(surfaces)) {
        return fallbackSurfaces;
    }
    const valid = surfaces.filter((surface) => VALID_CANDIDATE_SURFACES.includes(surface));
    return valid.length > 0 ? [...new Set(valid)] : fallbackSurfaces;
}
function sanitizeEvidenceGoals(fallback, compiledGoals, candidateSurfaces, evidenceFidelity) {
    const finish = (goals) => uniqueGoalsByText(goals).slice(0, fallback.evidencePlan?.operation.type === "tailor_advice" ? 4 : 3);
    if (!Array.isArray(compiledGoals)) {
        return finish(buildDefaultEvidenceGoals({
            query: fallback.queryText,
            focusedQuery: fallback.focusedQuery,
            anchors: fallback.anchors,
            candidateSurfaces,
            evidenceFidelity,
            evidenceCoverage: fallback.evidenceCoverage,
        }));
    }
    const sanitized = compiledGoals
        .map((goal) => {
        if (!goal || typeof goal !== "object") {
            return null;
        }
        const entry = goal;
        const goalText = typeof entry.goal === "string" ? entry.goal.trim() : "";
        const rawPositiveQueries = Array.isArray(entry.positiveQueries)
            ? entry.positiveQueries.filter((query) => typeof query === "string")
            : [];
        const focusAnchors = uniqueNonEmpty([
            ...(fallback.evidenceCoverage?.requiredAnchors ?? []),
            ...(Array.isArray(entry.focusAnchors)
                ? entry.focusAnchors.filter((anchor) => typeof anchor === "string")
                : []),
        ]
            .map(normalizeCompilerHint)
            .filter(Boolean)
            .filter((anchor) => isAllowedGoalAnchor(anchor, fallback)), 6);
        const positiveQueries = uniqueNonEmpty([
            ...rawPositiveQueries.filter((query) => retrievalHintAllowed(query)),
            fallback.focusedQuery,
        ], 7);
        const negativeHints = uniqueNonEmpty(Array.isArray(entry.negativeHints)
            ? entry.negativeHints.filter((hint) => typeof hint === "string")
            : [], 4);
        const fidelity = entry.fidelity === "low" || entry.fidelity === "medium" || entry.fidelity === "high"
            ? entry.fidelity
            : evidenceFidelity;
        const preferredSurfaceSet = new Set(normalizeGoalSurfaces(entry.preferredSurfaces, candidateSurfaces));
        if (fidelity === "high" || fallback.answerGranularity === "detail") {
            for (const surface of candidateSurfaces) {
                if (surface === "event" || surface === "chunk") {
                    preferredSurfaceSet.add(surface);
                }
            }
        }
        const preferredSurfaces = [...preferredSurfaceSet];
        if (!goalText && positiveQueries.length === 0) {
            return null;
        }
        return {
            goal: goalText || `Find remembered evidence that answers: ${fallback.focusedQuery}`,
            positiveQueries: positiveQueries.length > 0 ? positiveQueries : [fallback.focusedQuery],
            negativeHints: negativeHints.length > 0 ? negativeHints : undefined,
            focusAnchors,
            preferredSurfaces,
            fidelity,
        };
    })
        .filter((goal) => Boolean(goal))
        .slice(0, fallback.evidencePlan?.operation.type === "tailor_advice" ? 5 : 3);
    return finish(sanitized.length > 0
        ? sanitized
        : buildDefaultEvidenceGoals({
            query: fallback.queryText,
            focusedQuery: fallback.focusedQuery,
            anchors: fallback.anchors,
            candidateSurfaces,
            evidenceFidelity,
            evidenceCoverage: fallback.evidenceCoverage,
        }));
}
function uniqueGoalsByText(goals) {
    const byGoal = new Map();
    for (const goal of goals) {
        const key = normalizeText(goal.goal);
        if (!key || byGoal.has(key)) {
            continue;
        }
        byGoal.set(key, goal);
    }
    return [...byGoal.values()];
}
function retrievalHintAllowed(query) {
    const normalized = normalizeText(query);
    if (!normalized || normalized.length > 140) {
        return false;
    }
    const compact = normalized.replace(/\s+/gu, "");
    if (compact.length < 2) {
        return false;
    }
    return true;
}
function sanitizeSlotTextArray(values, fallback, limit) {
    if (!Array.isArray(values)) {
        return fallback;
    }
    const cleaned = uniqueNonEmpty(values
        .filter((value) => typeof value === "string")
        .map(normalizeCompilerHint)
        .filter(Boolean), limit);
    return cleaned.length > 0 ? cleaned : fallback;
}
function sanitizeRequiredFields(values, fallback) {
    if (!Array.isArray(values)) {
        return fallback;
    }
    const cleaned = uniqueNonEmpty(values
        .filter((value) => typeof value === "string")
        .map((value) => normalizeText(value)
        .replace(/[^a-z0-9_ -]/giu, " ")
        .trim())
        .filter((value) => value.length > 0)
        .map((value) => value.replace(/\s+/gu, "_")), 4);
    return cleaned.length > 0 ? cleaned : fallback;
}
function sanitizeSlotRole(value, fallback) {
    if (typeof value !== "string") {
        return fallback;
    }
    const normalized = normalizeText(value).replace(/\s+/gu, "_");
    return VALID_EVIDENCE_SLOT_ROLES.includes(normalized)
        ? normalized
        : fallback;
}
function sanitizeRequiredRole(value, fallback) {
    if (typeof value !== "string") {
        return fallback;
    }
    const normalized = normalizeText(value).replace(/\s+/gu, "_");
    return normalized === "query_context" ||
        normalized === "user_resource" ||
        normalized === "prior_advice" ||
        normalized === "answer_value" ||
        normalized === "answer_event" ||
        normalized === "time_constraint"
        ? normalized
        : fallback;
}
function ensureTailorAdviceSlots(plan, fallback) {
    if (plan.operation.type !== "tailor_advice") {
        return plan;
    }
    const existingHints = uniqueNonEmpty(plan.slots.flatMap((slot) => [...slot.subjectHints, ...slot.relationHints, slot.description]), 12);
    const queryHints = uniqueNonEmpty(usefulQueryHints([...fallback.anchors, fallback.focusedQuery, fallback.queryText]), 6);
    const makeSlot = (slot) => {
        const existing = plan.slots.find((entry) => entry.id === slot.id);
        if (!existing) {
            return slot;
        }
        return {
            ...slot,
            role: existing.role ?? slot.role,
            requiredRole: existing.requiredRole ?? slot.requiredRole,
            description: existing.description || slot.description,
            subjectHints: uniqueNonEmpty([...existing.subjectHints, ...slot.subjectHints], 8),
            relationHints: uniqueNonEmpty([...existing.relationHints, ...slot.relationHints], 10),
            capabilityQueries: uniqueNonEmpty([...(existing.capabilityQueries ?? []), ...(slot.capabilityQueries ?? [])], 10),
            negativeHints: uniqueNonEmpty([...(existing.negativeHints ?? []), ...(slot.negativeHints ?? [])], 8),
            requiredFields: uniqueNonEmpty([...existing.requiredFields, ...slot.requiredFields], 6),
            preferredLayers: [...new Set([...slot.preferredLayers, ...existing.preferredLayers])].slice(0, 12),
            fallbackLayers: [...new Set([...slot.fallbackLayers, ...existing.fallbackLayers])].slice(0, 12),
            minEvidence: Math.max(slot.minEvidence, existing.minEvidence),
        };
    };
    return {
        ...plan,
        slots: [
            makeSlot(slotFromHints({
                id: "current_need",
                role: "query_context",
                requiredRole: "query_context",
                description: "Current user need or problem to tailor advice for.",
                subjectHints: queryHints,
                relationHints: uniqueNonEmpty(["current user need", ...existingHints], 6),
                capabilityQueries: [],
                requiredFields: ["query_context"],
                preferredLayers: ["chunk", "snippet"],
                fallbackLayers: ["task", "event", "chunk", "snippet"],
                minEvidence: 1,
            })),
            makeSlot(slotFromHints({
                id: "relevant_user_resources",
                role: "user_resource",
                requiredRole: "user_resource",
                description: "Remembered user resources or constraints that could change the advice.",
                subjectHints: queryHints,
                relationHints: uniqueNonEmpty(["resource affordance for current need", ...existingHints], 6),
                capabilityQueries: uniqueNonEmpty([
                    `user resources tools or constraints that can help with ${fallback.focusedQuery || fallback.queryText}`,
                    `owned or available resources with affordances relevant to ${fallback.focusedQuery || fallback.queryText}`,
                ], 4),
                negativeHints: ["unrelated advice topics", "resources unrelated to the current need"],
                requiredFields: ["source_evidence"],
                preferredLayers: ["state", "fact", "graph", "event", "chunk"],
                fallbackLayers: ["entity_alias", "fact", "event", "chunk", "snippet"],
                minEvidence: 1,
            })),
            makeSlot(slotFromHints({
                id: "prior_advice_or_strategy",
                role: "prior_advice",
                requiredRole: "prior_advice",
                description: "Remembered prior advice, strategy, or abstraction for this problem.",
                subjectHints: queryHints,
                relationHints: uniqueNonEmpty(["prior advice for current need", ...existingHints], 6),
                capabilityQueries: uniqueNonEmpty([`prior advice or strategy relevant to ${fallback.focusedQuery || fallback.queryText}`], 4),
                negativeHints: ["unrelated advice topics"],
                requiredFields: ["source_evidence"],
                preferredLayers: ["strategy", "abstraction", "belief", "fact", "chunk"],
                fallbackLayers: ["event", "chunk", "snippet"],
                minEvidence: 1,
            })),
        ],
    };
}
function effectiveSlotRequiredRole(slot) {
    if (slot.requiredRole) {
        return slot.requiredRole;
    }
    if (slot.role === "answer_evidence") {
        return "answer_value";
    }
    if (slot.role === "query_context" ||
        slot.role === "user_resource" ||
        slot.role === "prior_advice" ||
        slot.role === "answer_value" ||
        slot.role === "answer_event" ||
        slot.role === "time_constraint") {
        return slot.role;
    }
    if (slot.role === "supporting_context") {
        return "query_context";
    }
    return undefined;
}
function ensureCoreEvidenceSlots(plan, fallbackPlan) {
    if (plan.operation.type === "tailor_advice") {
        return plan;
    }
    const requiredRoles = plan.operation.type === "aggregate"
        ? ["answer_event", "time_constraint"]
        : plan.operation.type === "derive" || plan.operation.type === "compare"
            ? ["answer_value", "time_constraint"]
            : ["query_context", "answer_value"];
    const slots = [...plan.slots];
    for (const role of requiredRoles) {
        if (slots.some((slot) => effectiveSlotRequiredRole(slot) === role)) {
            continue;
        }
        const fallbackSlot = fallbackPlan.slots.find((slot) => effectiveSlotRequiredRole(slot) === role) ??
            fallbackPlan.slots.find((slot) => slot.id === role);
        if (fallbackSlot) {
            slots.push(fallbackSlot);
        }
    }
    return {
        ...plan,
        slots: slots.slice(0, 6),
    };
}
function sanitizeEvidencePlan(fallback, compiledPlan) {
    const fallbackPlan = buildDefaultEvidencePlan({
        query: fallback.queryText,
        focusedQuery: fallback.focusedQuery,
        queryShape: fallback.queryShape,
        anchors: fallback.anchors,
        candidateSurfaces: fallback.candidateSurfaces,
        answerMode: fallback.answerMode ?? deriveAnswerMode(fallback.queryText, fallback.queryShape),
    });
    if (!compiledPlan || typeof compiledPlan !== "object") {
        return fallbackPlan;
    }
    const plan = compiledPlan;
    const rawSlots = Array.isArray(plan.slots) ? plan.slots : [];
    const slots = rawSlots
        .map((slot, index) => {
        if (!slot || typeof slot !== "object") {
            return null;
        }
        const entry = slot;
        const fallbackSlot = fallbackPlan.slots[Math.min(index, fallbackPlan.slots.length - 1)] ?? fallbackPlan.slots[0];
        if (!fallbackSlot) {
            return null;
        }
        const rawId = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : `slot_${index + 1}`;
        const id = rawId.replace(/[^a-z0-9_-]/giu, "_").slice(0, 48) || `slot_${index + 1}`;
        const description = typeof entry.description === "string" && entry.description.trim()
            ? entry.description.trim().slice(0, 220)
            : fallbackSlot.description;
        const role = sanitizeSlotRole(entry.role, fallbackSlot.role);
        const requiredRole = sanitizeRequiredRole(entry.requiredRole, fallbackSlot.requiredRole);
        const subjectHints = sanitizeSlotTextArray(entry.subjectHints, fallbackSlot.subjectHints, 6).filter((hint) => isAllowedGoalAnchor(hint, fallback));
        const relationHintLimit = 8;
        const compiledRelationHints = sanitizeSlotTextArray(entry.relationHints, fallbackSlot.relationHints ?? [], 8);
        const relationHints = uniqueNonEmpty([...compiledRelationHints, ...(fallbackSlot.relationHints ?? [])], relationHintLimit);
        const capabilityQueries = uniqueNonEmpty([
            ...sanitizeSlotTextArray(entry.capabilityQueries, fallbackSlot.capabilityQueries ?? [], 8),
            ...(fallbackSlot.capabilityQueries ?? []),
        ].filter(retrievalHintAllowed), 10);
        const negativeHints = uniqueNonEmpty([
            ...sanitizeSlotTextArray(entry.negativeHints, fallbackSlot.negativeHints ?? [], 6),
            ...(fallbackSlot.negativeHints ?? []),
        ], 8);
        const requiredFields = sanitizeRequiredFields(entry.requiredFields, fallbackSlot.requiredFields);
        const preferredLayers = normalizePlanLayers([
            ...fallbackSlot.preferredLayers,
            ...(Array.isArray(entry.preferredLayers) ? entry.preferredLayers : []),
        ], fallbackSlot.preferredLayers);
        const fallbackLayers = normalizePlanLayers([
            ...fallbackSlot.fallbackLayers,
            ...(Array.isArray(entry.fallbackLayers) ? entry.fallbackLayers : []),
        ], fallbackSlot.fallbackLayers);
        const minEvidence = typeof entry.minEvidence === "number" && Number.isFinite(entry.minEvidence)
            ? Math.max(1, Math.min(4, Math.trunc(entry.minEvidence)))
            : fallbackSlot.minEvidence;
        return {
            id,
            ...(role ? { role } : {}),
            ...(requiredRole ? { requiredRole } : {}),
            description,
            subjectHints: subjectHints.length > 0 ? subjectHints : fallbackSlot.subjectHints,
            relationHints,
            capabilityQueries,
            negativeHints,
            requiredFields,
            preferredLayers,
            fallbackLayers,
            minEvidence,
        };
    })
        .filter((slot) => Boolean(slot))
        .slice(0, 4);
    const operationInput = plan.operation && typeof plan.operation === "object"
        ? plan.operation
        : {};
    const operationType = sanitizeEvidenceOperationType(operationInput.type, fallbackPlan.operation.type);
    const operationDescription = typeof operationInput.description === "string" && operationInput.description.trim()
        ? operationInput.description.trim().slice(0, 260)
        : fallbackPlan.operation.description;
    const sanitizedPlan = ensureCoreEvidenceSlots({
        slots: slots.length > 0 ? slots : fallbackPlan.slots,
        operation: {
            type: operationType,
            description: operationDescription,
        },
    }, fallbackPlan);
    return ensureTailorAdviceSlots(sanitizedPlan, fallback);
}
function semanticBridgeShapeForRole(role, operation) {
    if (role === "user_resource") {
        return "resource_affordance";
    }
    if (role === "answer_event" || operation === "aggregate") {
        return operation === "aggregate" ? "aggregate_item" : "event";
    }
    if (role === "time_constraint") {
        return "time_constraint";
    }
    if (role === "query_context") {
        return "query_context";
    }
    return "attribute_value";
}
function defaultSemanticBridgeQueries(slot, fallback) {
    const role = effectiveSlotRequiredRole(slot);
    const operation = fallback.evidencePlan?.operation.type;
    const base = compactEvidenceContractHints([
        slot.description,
        ...slot.subjectHints,
        ...(slot.relationHints ?? []),
        ...(slot.capabilityQueries ?? []),
        ...slot.requiredFields,
        fallback.focusedQuery,
    ], { operation, limit: role === "user_resource" ? 7 : 5 });
    return base.length > 0 ? base : [fallback.focusedQuery || fallback.queryText];
}
function buildDefaultSemanticBridges(fallback) {
    const operation = fallback.evidencePlan?.operation.type ?? "return_value";
    return (fallback.evidencePlan?.slots ?? [])
        .map((slot) => {
        const role = effectiveSlotRequiredRole(slot);
        if (!role) {
            return null;
        }
        const retrievalQueries = defaultSemanticBridgeQueries(slot, fallback);
        return {
            bridgeId: `bridge_${slot.id}`.replace(/[^a-z0-9_-]/giu, "_").slice(0, 64),
            sourceConcept: slot.description || slot.id,
            role,
            evidenceShape: semanticBridgeShapeForRole(role, operation),
            retrievalQueries,
            positiveSignals: compactEvidenceContractHints([
                ...retrievalQueries,
                ...slot.subjectHints,
                ...(slot.relationHints ?? []),
                ...(slot.capabilityQueries ?? []),
            ], { operation, limit: 8 }),
            negativeSignals: uniqueNonEmpty(slot.negativeHints ?? [], 6),
            preferredLayers: normalizePlanLayers([...slot.preferredLayers, ...slot.fallbackLayers], fallback.candidateSurfaces),
            hypothesisOnly: true,
        };
    })
        .filter((bridge) => Boolean(bridge))
        .slice(0, 6);
}
function sanitizeBridgeRole(value, fallback) {
    return sanitizeRequiredRole(value, fallback) ?? fallback;
}
function sanitizeBridgeShape(value, fallback) {
    if (typeof value !== "string") {
        return fallback;
    }
    const normalized = normalizeText(value).replace(/\s+/gu, "_");
    return normalized === "event" ||
        normalized === "attribute_value" ||
        normalized === "resource_affordance" ||
        normalized === "query_context" ||
        normalized === "time_constraint" ||
        normalized === "aggregate_item" ||
        normalized === "causal_explanation" ||
        normalized === "validation_evidence" ||
        normalized === "status_answer" ||
        normalized === "decision_value" ||
        normalized === "availability_statement"
        ? normalized
        : fallback;
}
function sanitizeSemanticBridges(fallback, compiledBridges) {
    const defaults = buildDefaultSemanticBridges(fallback);
    if (!Array.isArray(compiledBridges)) {
        return defaults;
    }
    const defaultByIndex = (index) => defaults[Math.min(index, Math.max(0, defaults.length - 1))];
    const bridges = compiledBridges
        .map((bridge, index) => {
        if (!bridge || typeof bridge !== "object") {
            return null;
        }
        const entry = bridge;
        const fallbackBridge = defaultByIndex(index);
        if (!fallbackBridge) {
            return null;
        }
        const rawId = typeof entry.bridgeId === "string" && entry.bridgeId.trim()
            ? entry.bridgeId.trim()
            : fallbackBridge.bridgeId;
        const role = sanitizeBridgeRole(entry.role, fallbackBridge.role);
        const operation = fallback.evidencePlan?.operation.type ?? "return_value";
        const retrievalQueries = compactEvidenceContractHints([
            ...(Array.isArray(entry.retrievalQueries)
                ? entry.retrievalQueries.filter((query) => typeof query === "string")
                : []),
            ...(compiledBridges.length === 0 ? fallbackBridge.retrievalQueries : []),
        ], { operation, limit: 8 });
        const positiveSignals = compactEvidenceContractHints([
            ...(Array.isArray(entry.positiveSignals)
                ? entry.positiveSignals.filter((signal) => typeof signal === "string")
                : []),
            ...(compiledBridges.length === 0 ? fallbackBridge.positiveSignals : []),
        ], { operation, limit: 10 });
        const negativeSignals = role === "answer_value" ||
            role === "answer_event" ||
            role === "user_resource" ||
            role === "prior_advice"
            ? []
            : compactEvidenceContractHints([
                ...(Array.isArray(entry.negativeSignals)
                    ? entry.negativeSignals.filter((signal) => typeof signal === "string")
                    : []),
                ...(fallbackBridge.negativeSignals ?? []),
            ], { operation, limit: 8 });
        if (retrievalQueries.length === 0 && positiveSignals.length === 0) {
            return null;
        }
        return {
            bridgeId: rawId.replace(/[^a-z0-9_-]/giu, "_").slice(0, 64) || `bridge_${index + 1}`,
            sourceConcept: typeof entry.sourceConcept === "string" && entry.sourceConcept.trim()
                ? entry.sourceConcept.trim().slice(0, 160)
                : fallbackBridge.sourceConcept,
            role,
            evidenceShape: sanitizeBridgeShape(entry.evidenceShape, semanticBridgeShapeForRole(role, fallback.evidencePlan?.operation.type ?? "return_value")),
            retrievalQueries: retrievalQueries.length > 0 ? retrievalQueries : positiveSignals,
            positiveSignals,
            negativeSignals: negativeSignals.length > 0 ? negativeSignals : undefined,
            preferredLayers: normalizeBridgePreferredLayers(entry.preferredLayers, fallbackBridge.preferredLayers, operation),
            hypothesisOnly: true,
        };
    })
        .filter((bridge) => Boolean(bridge));
    const merged = bridges.length > 0 ? bridges : defaults;
    const byId = new Map();
    for (const bridge of merged) {
        if (!byId.has(bridge.bridgeId)) {
            byId.set(bridge.bridgeId, bridge);
        }
    }
    return [...byId.values()].slice(0, 8);
}
function shouldAddEpisodicRecoverySurface(query, compiled) {
    return (compiled.queryShape.evidenceNeed === "canonical_state" &&
        compiled.queryShape.timeframe === "timeless" &&
        compiled.queryShape.referentialMode === "anchored" &&
        compiled.anchors.length > 0 &&
        !looksShortAndContextDependent(query) &&
        (compiled.turnMode === "memory_qa" || compiled.turnMode === "mixed") &&
        (compiled.answerGranularity === "detail" ||
            compiled.anchors.length > 1 ||
            compiled.supportNeed >= 0.56));
}
function applyQueryCompileGuards(query, compiled) {
    const guarded = { ...compiled };
    guarded.answerMode = sanitizeAnswerMode(compiled.answerMode, query, guarded.queryShape);
    guarded.anchors = uniqueNonEmpty([
        ...guarded.anchors.map(normalizeCompilerHint).filter(usefulQueryHint),
        ...(guarded.compilerProvenance.source === "llm"
            ? []
            : deriveTopicAnchors(query, guarded.answerMode, guarded.anchors)),
    ], 8);
    guarded.evidenceCoverage = sanitizeEvidenceCoverage(query, guarded);
    if (shouldAddEpisodicRecoverySurface(query, guarded)) {
        guarded.candidateSurfaces = [...new Set([...guarded.candidateSurfaces, "event", "chunk"])];
        guarded.answerGranularity = "detail";
        guarded.detailNeedScore = Math.max(guarded.detailNeedScore, 0.92);
        guarded.evidenceFidelity = "high";
        guarded.supportNeed = clamp01(Math.max(guarded.supportNeed, 0.72));
        guarded.compilerProvenance = {
            ...guarded.compilerProvenance,
            source: guarded.compilerProvenance.source === "llm" ? "hybrid" : guarded.compilerProvenance.source,
            reasons: [
                ...(guarded.compilerProvenance.reasons ?? []),
                "episodic-recovery-surface:event",
                "episodic-recovery-surface:chunk",
                "episodic-recovery-granularity:detail",
                "episodic-recovery-fidelity:high",
            ],
        };
    }
    if (guarded.turnMode === "memory_qa" &&
        guarded.queryShape.evidenceNeed === "canonical_state" &&
        guarded.answerGranularity === "detail" &&
        !guarded.candidateSurfaces.includes("chunk")) {
        guarded.candidateSurfaces = [...new Set([...guarded.candidateSurfaces, "chunk"])];
        guarded.compilerProvenance = {
            ...guarded.compilerProvenance,
            source: guarded.compilerProvenance.source === "llm" ? "hybrid" : guarded.compilerProvenance.source,
            reasons: [...(guarded.compilerProvenance.reasons ?? []), "detail-surface-recovery:chunk"],
        };
    }
    guarded.evidenceGoals = sanitizeEvidenceGoals({
        ...guarded,
        queryText: query,
        focusedQuery: guarded.focusedQuery || query,
        anchors: guarded.anchors,
        candidateSurfaces: guarded.candidateSurfaces,
        evidenceFidelity: guarded.evidenceFidelity,
        evidenceCoverage: guarded.evidenceCoverage,
    }, guarded.evidenceGoals, guarded.candidateSurfaces, guarded.evidenceFidelity);
    guarded.evidencePlan = sanitizeEvidencePlan({
        ...guarded,
        queryText: query,
        focusedQuery: guarded.focusedQuery || query,
        anchors: guarded.anchors,
        candidateSurfaces: guarded.candidateSurfaces,
        evidenceFidelity: guarded.evidenceFidelity,
        evidenceCoverage: guarded.evidenceCoverage,
    }, guarded.evidencePlan);
    guarded.semanticBridges = sanitizeSemanticBridges({
        ...guarded,
        queryText: query,
        focusedQuery: guarded.focusedQuery || query,
        anchors: guarded.anchors,
        candidateSurfaces: guarded.candidateSurfaces,
        evidenceFidelity: guarded.evidenceFidelity,
        evidenceCoverage: guarded.evidenceCoverage,
        evidencePlan: guarded.evidencePlan,
    }, guarded.semanticBridges);
    return guarded;
}
function ambiguityLevel(routeWeights, anchors, queryShape) {
    const ordered = PRIMARY_ROUTE_TYPES.map((routeType) => routeWeights[routeType] ?? 0).sort((a, b) => b - a);
    const top = ordered[0] ?? 0;
    const second = ordered[1] ?? 0;
    let ambiguity = clamp01(1 - (top - second));
    if (anchors.length === 0) {
        ambiguity = clamp01(ambiguity + 0.12);
    }
    if (queryShape.referentialMode === "deictic") {
        ambiguity = clamp01(ambiguity + 0.08);
    }
    return ambiguity;
}
function looksShortAndContextDependent(query) {
    const normalized = query.trim();
    const tokenCount = normalized.split(/\s+/u).filter(Boolean).length;
    return normalized.length <= 28 || tokenCount <= 4;
}
function isDeterministicallyObviousQuery(_query, _compiled) {
    return false;
}
export function compileQueryDeterministically(query) {
    const queryShape = analyzeQueryShape(query);
    const anchors = extractQueryAnchors(query);
    const answerGranularity = deriveAnswerGranularity(queryShape);
    const evidenceFidelity = deriveEvidenceFidelity(queryShape, anchors);
    const routeWeights = deriveRouteWeights(queryShape);
    const candidateSurfaces = deriveCandidateSurfaces(queryShape, answerGranularity, evidenceFidelity);
    const supportNeed = clamp01((queryShape.timeframe === "compare"
        ? 0.9
        : queryShape.timeframe === "historical"
            ? 0.72
            : 0.48) +
        (queryShape.evidenceNeed === "workflow_context" ? 0.12 : 0) +
        (evidenceFidelity === "high" ? 0.18 : evidenceFidelity === "medium" ? 0.08 : 0));
    return applyQueryCompileGuards(query, {
        queryText: query,
        focusedQuery: query,
        queryShape,
        answerGranularity,
        evidenceFidelity,
        routeWeights,
        anchors,
        candidateSurfaces,
        evidenceGoals: buildDefaultEvidenceGoals({
            query,
            focusedQuery: query,
            anchors,
            candidateSurfaces,
            evidenceFidelity,
        }),
        evidencePlan: buildDefaultEvidencePlan({
            query,
            focusedQuery: query,
            queryShape,
            anchors,
            candidateSurfaces,
            answerMode: deriveAnswerMode(query, queryShape),
        }),
        detailNeedScore: answerGranularity === "detail" ? 0.92 : 0.28,
        supportNeed,
        ambiguityLevel: ambiguityLevel(routeWeights, anchors, queryShape),
        turnMode: computeTurnMode(query, queryShape),
        compilerProvenance: {
            source: "deterministic",
            mode: "deterministic",
            reasons: [`criteria=${QUERY_COMPILER_CUTOVER_CRITERIA.requiredScenes.join(",")}`],
        },
    });
}
function mergeCompiledQuery(fallback, compiled) {
    const candidateSurfaces = compiled.candidateSurfaces && compiled.candidateSurfaces.length > 0
        ? compiled.candidateSurfaces
        : fallback.candidateSurfaces;
    const evidenceFidelity = compiled.evidenceFidelity ?? fallback.evidenceFidelity;
    const compilerProvenance = compiled.compilerProvenance ?? fallback.compilerProvenance;
    const focusedQuery = typeof compiled.focusedQuery === "string" && compiled.focusedQuery.trim()
        ? compiled.focusedQuery.trim()
        : fallback.focusedQuery;
    const anchors = compiled.anchors && compiled.anchors.length > 0 ? compiled.anchors : fallback.anchors;
    const sanitizerFallback = {
        ...fallback,
        ...compiled,
        queryText: fallback.queryText,
        focusedQuery,
        anchors,
        candidateSurfaces,
        evidenceFidelity,
        compilerProvenance,
    };
    const sanitizedPlan = sanitizeEvidencePlan(sanitizerFallback, compiled.evidencePlan);
    const bridgeFallback = {
        ...sanitizerFallback,
        evidencePlan: sanitizedPlan,
    };
    return {
        ...fallback,
        ...compiled,
        queryText: fallback.queryText,
        focusedQuery,
        queryShape: compiled.queryShape ?? fallback.queryShape,
        answerGranularity: compiled.answerGranularity ?? fallback.answerGranularity,
        evidenceFidelity,
        routeWeights: compiled.routeWeights ?? fallback.routeWeights,
        anchors,
        candidateSurfaces,
        evidenceGoals: sanitizeEvidenceGoals(sanitizerFallback, compiled.evidenceGoals, candidateSurfaces, evidenceFidelity),
        evidencePlan: sanitizedPlan,
        semanticBridges: sanitizeSemanticBridges(bridgeFallback, compiled.semanticBridges),
        detailNeedScore: typeof compiled.detailNeedScore === "number" && Number.isFinite(compiled.detailNeedScore)
            ? clamp01(compiled.detailNeedScore)
            : fallback.detailNeedScore,
        supportNeed: typeof compiled.supportNeed === "number" && Number.isFinite(compiled.supportNeed)
            ? clamp01(compiled.supportNeed)
            : fallback.supportNeed,
        ambiguityLevel: typeof compiled.ambiguityLevel === "number" && Number.isFinite(compiled.ambiguityLevel)
            ? clamp01(compiled.ambiguityLevel)
            : fallback.ambiguityLevel,
        turnMode: compiled.turnMode ?? fallback.turnMode,
        compilerProvenance,
    };
}
export async function compileQuery(params) {
    const fallback = compileQueryDeterministically(params.query);
    if (!params.ctx.config.advanced.enableQueryCompiler ||
        !params.reasoner?.isEnabled?.() ||
        !params.reasoner.compileQuerySemantics) {
        recordMemoryLlmBudgetCall(params.ctx.llmBudgetAudit, {
            label: "query-compile",
            stage: "query_hot_path",
            provenance: "deterministic",
            mode: "deterministic",
            detail: "queryCompiler stayed on the deterministic path",
        });
        return fallback;
    }
    const obvious = isDeterministicallyObviousQuery(params.query, fallback);
    if (obvious) {
        recordMemoryLlmBudgetCall(params.ctx.llmBudgetAudit, {
            label: "query-compile",
            stage: "query_hot_path",
            provenance: "deterministic",
            mode: "deterministic",
            detail: "queryCompiler skipped the LLM because the query shape was obvious",
        });
        return fallback;
    }
    const compiled = await params.reasoner.compileQuerySemantics(params.query, fallback, {
        stage: "query_hot_path",
        audit: params.ctx.llmBudgetAudit,
    });
    if (!compiled) {
        return applyQueryCompileGuards(params.query, {
            ...fallback,
            compilerProvenance: {
                source: "hybrid",
                mode: "fallback",
                reasons: ["query-compile-fallback"],
            },
        });
    }
    return applyQueryCompileGuards(params.query, mergeCompiledQuery(fallback, {
        compilerProvenance: {
            source: "llm",
            mode: "llm",
        },
        ...compiled,
    }));
}
