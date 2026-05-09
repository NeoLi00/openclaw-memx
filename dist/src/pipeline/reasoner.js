import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { clamp01, normalizeText, truncateText } from "../support.js";
import { sanitizeTaskMetadata } from "./authority.js";
import { recordMemoryLlmBudgetCall } from "./llmBudgetAudit.js";
import { canonicalStateKey, tokenizeSearchTerms } from "./semantic/heuristics.js";
import { basicSemanticSimilarity } from "./semantic/textSimilarity.js";
import { canonicalizePreferencePredicate, judgeQueryRoute, normalizeGraphRelationType, parsePreferenceSignal, parseRelation, parseWorkflowState, } from "./semantics.js";
import { assessAssistantChunk, renderTaskPromptChunk } from "./sourceWeighting.js";
import { summarizeTaskHeuristically } from "./taskSummary.js";
const PRIMARY_ROUTE_TYPES = [
    "workflow",
    "factual",
    "temporal",
    "explanatory",
];
function isPrimaryRouteType(value) {
    return (value === "workflow" || value === "factual" || value === "temporal" || value === "explanatory");
}
function isRouteType(value) {
    return isPrimaryRouteType(value) || value === "mixed" || value === "unknown";
}
function isTaskPhase(value) {
    return (value === "investigating" ||
        value === "proposed" ||
        value === "attempting" ||
        value === "validated" ||
        value === "resolved" ||
        value === "reopened");
}
function isMemoryAction(value) {
    return (value === "ignore" ||
        value === "session_state" ||
        value === "durable_state" ||
        value === "stable_fact" ||
        value === "episodic_event" ||
        value === "graph_relation");
}
function isAbstractionCandidateJudgeStage(value) {
    return value === "candidate" || value === "probationary" || value === "quarantined";
}
function normalizePreferenceHint(value) {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const record = value;
    if (typeof record.predicate !== "string" || typeof record.object !== "string") {
        return undefined;
    }
    const predicate = canonicalizePreferencePredicate(record.predicate);
    if (!predicate) {
        return undefined;
    }
    return {
        predicate,
        object: record.object.trim(),
        guidance: normalizeGuidanceFacet(record.guidance),
        confidence: typeof record.confidence === "number" && Number.isFinite(record.confidence)
            ? clamp01(record.confidence)
            : undefined,
        reason: typeof record.reason === "string" ? record.reason.trim() : undefined,
    };
}
function isGuidanceType(value) {
    return (value === "language" ||
        value === "style" ||
        value === "charset" ||
        value === "output_order" ||
        value === "generic_preference");
}
function normalizeGuidanceFacet(value) {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const record = value;
    if (!isGuidanceType(record.guidanceType) || typeof record.guidanceText !== "string") {
        return undefined;
    }
    const guidanceText = record.guidanceText.trim();
    if (!guidanceText) {
        return undefined;
    }
    return {
        guidanceType: record.guidanceType,
        guidanceText,
        confidence: typeof record.confidence === "number" && Number.isFinite(record.confidence)
            ? clamp01(record.confidence)
            : undefined,
        reason: typeof record.reason === "string" ? record.reason.trim() : undefined,
    };
}
function normalizeWorkflowHint(value) {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const record = value;
    if (typeof record.key !== "string" ||
        !record.value ||
        typeof record.value !== "object" ||
        Array.isArray(record.value)) {
        return undefined;
    }
    return {
        key: canonicalStateKey(record.key.trim()),
        value: record.value,
        stateKind: record.stateKind === "session" || record.stateKind === "durable"
            ? record.stateKind
            : undefined,
        confidence: typeof record.confidence === "number" && Number.isFinite(record.confidence)
            ? clamp01(record.confidence)
            : undefined,
        reason: typeof record.reason === "string" ? record.reason.trim() : undefined,
    };
}
function normalizeWorkflowHints(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set();
    const normalized = [];
    for (const entry of value) {
        const workflow = normalizeWorkflowHint(entry);
        if (!workflow) {
            continue;
        }
        const dedupKey = `${workflow.key}:${JSON.stringify(workflow.value)}`;
        if (seen.has(dedupKey)) {
            continue;
        }
        seen.add(dedupKey);
        normalized.push(workflow);
    }
    return normalized;
}
function normalizeRelationHint(value) {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const record = value;
    if (typeof record.subject !== "string" ||
        typeof record.predicate !== "string" ||
        typeof record.object !== "string") {
        return undefined;
    }
    const normalizedPredicate = normalizeGraphRelationType(record.predicate);
    if (!normalizedPredicate) {
        return undefined;
    }
    const predicateLabel = normalizeText(record.predicate).replace(/[^\p{L}\p{N}]+/gu, "_");
    const inverseStructuredPredicate = new Set(["owned_by", "blocked_by"]).has(predicateLabel);
    const subject = inverseStructuredPredicate ? record.object : record.subject;
    const object = inverseStructuredPredicate ? record.subject : record.object;
    const relationSlot = typeof record.slot === "string" && record.slot.trim()
        ? normalizeText(record.slot)
            .replace(/[^\p{L}\p{N}]+/gu, "_")
            .replace(/^_+|_+$/g, "")
        : typeof record.relationSlot === "string" && record.relationSlot.trim()
            ? normalizeText(record.relationSlot)
                .replace(/[^\p{L}\p{N}]+/gu, "_")
                .replace(/^_+|_+$/g, "")
            : undefined;
    return {
        subject: subject.trim(),
        predicate: normalizedPredicate.relationType,
        object: object.trim(),
        sourceRef: typeof record.sourceRef === "string" ? record.sourceRef.trim() : undefined,
        polarity: record.polarity === "negated" || record.negated === true ? "negated" : "affirmed",
        rawPredicate: typeof record.rawPredicate === "string" && record.rawPredicate.trim()
            ? record.rawPredicate.trim()
            : normalizedPredicate.rawPredicate,
        ...(relationSlot ? { relationSlot } : {}),
        confidence: typeof record.confidence === "number" && Number.isFinite(record.confidence)
            ? clamp01(record.confidence)
            : undefined,
        reason: typeof record.reason === "string" ? record.reason.trim() : undefined,
    };
}
function normalizeRelationHints(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set();
    const normalized = [];
    for (const entry of value) {
        const relation = normalizeRelationHint(entry);
        if (!relation) {
            continue;
        }
        const dedupKey = `${normalizeText(relation.subject)}:${relation.predicate}:${relation.polarity ?? "affirmed"}:${normalizeText(relation.object)}`;
        if (seen.has(dedupKey)) {
            continue;
        }
        seen.add(dedupKey);
        normalized.push(relation);
    }
    return normalized;
}
function normalizeDecisionHint(value) {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const record = value;
    if (typeof record.summary !== "string") {
        return undefined;
    }
    return {
        summary: record.summary.trim(),
        confidence: typeof record.confidence === "number" && Number.isFinite(record.confidence)
            ? clamp01(record.confidence)
            : undefined,
        reason: typeof record.reason === "string" ? record.reason.trim() : undefined,
    };
}
function resolveEnvTemplate(value) {
    const match = /^\$\{([A-Z][A-Z0-9_]*)\}$/.exec(value.trim());
    if (!match) {
        return value.trim() || undefined;
    }
    return process.env[match[1]]?.trim() || undefined;
}
function resolveSecretLikeString(value) {
    if (typeof value === "string") {
        return resolveEnvTemplate(value);
    }
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const record = value;
    if (record.source === "env" && typeof record.id === "string") {
        return process.env[record.id]?.trim() || undefined;
    }
    return undefined;
}
function normalizeOpenAiEndpoint(baseUrl) {
    const trimmed = baseUrl.replace(/\/+$/, "");
    if (trimmed.endsWith("/chat/completions")) {
        return trimmed;
    }
    if (trimmed.endsWith("/responses")) {
        return trimmed;
    }
    return `${trimmed}/chat/completions`;
}
function normalizeAnthropicEndpoint(baseUrl) {
    const trimmed = baseUrl.replace(/\/+$/, "");
    return trimmed.endsWith("/messages") ? trimmed : `${trimmed}/messages`;
}
function normalizeGoogleEndpoint(baseUrl, model, apiKey) {
    const trimmed = baseUrl.replace(/\/+$/, "");
    if (trimmed.includes(":generateContent")) {
        return trimmed.includes("?key=") ? trimmed : `${trimmed}?key=${encodeURIComponent(apiKey)}`;
    }
    return `${trimmed}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}
function normalizeOllamaEndpoint(baseUrl) {
    const trimmed = baseUrl.replace(/\/+$/, "");
    return trimmed.endsWith("/api/chat") ? trimmed : `${trimmed}/api/chat`;
}
function extractTextContent(payload) {
    if (typeof payload === "string") {
        return payload.trim();
    }
    if (Array.isArray(payload)) {
        return payload
            .map((entry) => extractTextContent(entry))
            .filter(Boolean)
            .join("\n")
            .trim();
    }
    if (!payload || typeof payload !== "object") {
        return "";
    }
    const record = payload;
    if (typeof record.text === "string") {
        return record.text.trim();
    }
    if (typeof record.output_text === "string") {
        return record.output_text.trim();
    }
    if (record.type === "text" && typeof record.text === "string") {
        return record.text.trim();
    }
    if (typeof record.content === "string") {
        return record.content.trim();
    }
    if (Array.isArray(record.content)) {
        return extractTextContent(record.content);
    }
    return "";
}
function parseJsonResponse(value) {
    const direct = value.trim();
    if (!direct) {
        return null;
    }
    const balancedObject = extractBalancedJsonObject(direct);
    const candidates = [
        direct,
        direct
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/```$/i, "")
            .trim(),
    ];
    if (balancedObject) {
        candidates.push(balancedObject);
    }
    for (const candidate of candidates) {
        if (!candidate) {
            continue;
        }
        try {
            return JSON.parse(candidate);
        }
        catch {
            continue;
        }
    }
    return null;
}
function extractBalancedJsonObject(value) {
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\") {
            escaped = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (inString) {
            continue;
        }
        if (char === "{") {
            if (depth === 0) {
                start = index;
            }
            depth += 1;
            continue;
        }
        if (char === "}") {
            if (depth === 0) {
                continue;
            }
            depth -= 1;
            if (depth === 0 && start >= 0) {
                return value.slice(start, index + 1);
            }
        }
    }
    return null;
}
function summarizeParseFailure(raw) {
    const trimmed = raw.trim();
    const balancedObject = extractBalancedJsonObject(trimmed);
    return [
        `len=${trimmed.length}`,
        `startsWithBrace=${trimmed.startsWith("{")}`,
        `endsWithBrace=${trimmed.endsWith("}")}`,
        `balancedObject=${Boolean(balancedObject)}`,
    ].join(" ");
}
function estimateTokenCount(text) {
    const trimmed = text.trim();
    if (!trimmed) {
        return 0;
    }
    // Maintenance cost only needs an order-of-magnitude estimate. Char-count
    // keeps the audit provider-agnostic while remaining comparable run to run.
    return Math.max(1, Math.ceil(trimmed.length / 4));
}
function summarizeHeuristically(content) {
    const flattened = content
        .replace(/```[\s\S]*?```/g, " code block ")
        .replace(/\s+/g, " ")
        .trim();
    if (!flattened) {
        return "";
    }
    const sentenceCut = flattened.search(/[。.!?！？]/u);
    if (sentenceCut > 16) {
        return truncateText(flattened.slice(0, sentenceCut + 1).trim(), 180);
    }
    return truncateText(flattened, 180);
}
function shouldUseHeuristicChunkSummary(content, role) {
    const trimmed = content.trim();
    if (!trimmed) {
        return true;
    }
    const lineCount = trimmed.split(/\r?\n/u).length;
    const hasCodeFence = trimmed.includes("```");
    const tokenCount = tokenizeSearchTerms(trimmed, new Set()).length;
    const containsHan = /[\u3400-\u9fff]/u.test(trimmed);
    const shortNaturalTurn = role !== "assistant" &&
        lineCount === 1 &&
        trimmed.length <= 120 &&
        (containsHan || tokenCount <= 5);
    const codeHeavyTurn = hasCodeFence || lineCount >= 12;
    const verboseAssistantTurn = role === "assistant" && (trimmed.length >= 600 || lineCount >= 10);
    return shortNaturalTurn || codeHeavyTurn || verboseAssistantTurn;
}
function conservativeDedupDecision(newSummary, candidates) {
    // Simple word-overlap (Jaccard) check to merge near-identical chunks
    if (candidates && candidates.length > 0) {
        const newTokens = new Set(newSummary
            .toLowerCase()
            .split(/[\s,.:;!?，。！？；：]+/u)
            .filter((t) => t.length > 1));
        if (newTokens.size > 0) {
            for (const candidate of candidates) {
                const candidateTokens = new Set(candidate.summary
                    .toLowerCase()
                    .split(/[\s,.:;!?，。！？；：]+/u)
                    .filter((t) => t.length > 1));
                if (candidateTokens.size === 0)
                    continue;
                let intersection = 0;
                for (const token of newTokens) {
                    if (candidateTokens.has(token))
                        intersection++;
                }
                const union = new Set([...newTokens, ...candidateTokens]).size;
                const jaccard = union > 0 ? intersection / union : 0;
                if (jaccard >= 0.7) {
                    return {
                        action: "MERGE",
                        targetIndex: candidate.index,
                        mergedSummary: truncateText(newSummary.trim(), 220) || undefined,
                        reason: `heuristic dedup: Jaccard=${jaccard.toFixed(2)} merge with existing chunk`,
                    };
                }
            }
        }
    }
    return {
        action: "NEW",
        mergedSummary: truncateText(newSummary.trim(), 220) || undefined,
        reason: "degraded dedup: keep the new memory separate until an LLM judgment is available",
    };
}
function conservativeRelevantDecision() {
    return {
        relevant: [],
        sufficient: false,
        reason: "degraded relevance filter: do not select evidence without an LLM judgment",
    };
}
function conservativeRecallPlan(query, judgmentMode) {
    const focusedQuery = truncateText(query.trim(), 160);
    const heuristic = focusedQuery ? judgeQueryRoute(query) : null;
    const routeHint = heuristic?.routeType === "workflow" ||
        heuristic?.routeType === "factual" ||
        heuristic?.routeType === "temporal" ||
        heuristic?.routeType === "explanatory" ||
        heuristic?.routeType === "mixed"
        ? heuristic.routeType
        : undefined;
    const shouldRecall = Boolean(routeHint);
    const reason = focusedQuery
        ? shouldRecall
            ? judgmentMode === "disabled"
                ? `heuristic recall planning: ${routeHint} route fallback because no judge model is configured`
                : `heuristic recall planning: ${routeHint} route fallback while LLM judgment recovers`
            : judgmentMode === "disabled"
                ? "recall planning unavailable: no reliable heuristic route and no judge model is configured"
                : "degraded recall planning: no reliable heuristic route while LLM judgment recovers"
        : "empty query";
    return {
        shouldRecall,
        focusedQuery,
        reason,
        routeHint,
        judgmentMode,
    };
}
function conservativeRoutePrior(query, judgmentMode) {
    const focusedQuery = truncateText(query.trim(), 180);
    const focusedQueries = focusedQuery
        ? Object.fromEntries(PRIMARY_ROUTE_TYPES.map((route) => [route, focusedQuery]))
        : {};
    const heuristic = focusedQuery ? judgeQueryRoute(query) : null;
    if (heuristic && heuristic.routeType !== "unknown") {
        return {
            primaryRoute: heuristic.routeType,
            secondaryRoutes: [],
            confidence: Math.max(0.35, heuristic.routeConfidence * 0.7),
            focusedQueries,
            reason: judgmentMode === "disabled"
                ? `heuristic route prior: ${heuristic.routeType} fallback because no judge model is configured`
                : `heuristic route prior: ${heuristic.routeType} fallback while LLM judgment recovers`,
            judgmentMode,
        };
    }
    return {
        primaryRoute: "unknown",
        secondaryRoutes: [],
        confidence: 0.05,
        focusedQueries,
        reason: focusedQuery
            ? judgmentMode === "disabled"
                ? "route prior unavailable: no reliable heuristic route and no judge model is configured"
                : "degraded route prior: no reliable heuristic route while LLM judgment recovers"
            : "degraded route prior: empty query",
        judgmentMode,
    };
}
function heuristicRoutePrior(query) {
    const heuristic = judgeQueryRoute(query);
    const focusedQuery = truncateText(query.trim(), 180);
    const focusedQueries = focusedQuery
        ? Object.fromEntries(PRIMARY_ROUTE_TYPES.map((route) => [route, focusedQuery]))
        : {};
    return {
        primaryRoute: heuristic.routeType,
        secondaryRoutes: [],
        confidence: Math.max(0.35, heuristic.routeConfidence * 0.7),
        focusedQueries,
        reason: heuristic.reasons?.[0] ?? "heuristic route prior",
        judgmentMode: "degraded",
    };
}
function conservativeRouteEvidenceDecision(routeType, judgmentMode) {
    return {
        relevant: [],
        sufficient: false,
        support: 0,
        reason: judgmentMode === "disabled"
            ? `route evidence unavailable for ${routeType}: defer to score-driven evidence support until a judge model is configured`
            : `degraded ${routeType} evidence: defer to score-driven evidence support until LLM judgment recovers`,
        judgmentMode,
    };
}
function conservativeOutcomePromotionDecision() {
    return {
        shouldPromote: false,
        promotionScore: 0,
        reason: "degraded promotion: keep the outcome provisional until an LLM judgment is available",
    };
}
function taskSummaryEvidenceSupport(text, chunks) {
    const query = text.trim();
    if (!query) {
        return {
            supported: false,
            bestScore: 0,
            groundedAssistantScore: 0,
            userOrToolScore: 0,
        };
    }
    let userOrToolScore = 0;
    let groundedAssistantScore = 0;
    for (const chunk of chunks) {
        const contentScore = basicSemanticSimilarity(query, chunk.content);
        const summaryScore = basicSemanticSimilarity(query, chunk.summary || chunk.content);
        const score = Math.max(contentScore, summaryScore);
        if (chunk.role === "assistant") {
            const assessment = assessAssistantChunk(chunk, chunks);
            groundedAssistantScore = Math.max(groundedAssistantScore, score * Math.max(0, assessment.weight));
            continue;
        }
        userOrToolScore = Math.max(userOrToolScore, score);
    }
    const bestScore = Math.max(userOrToolScore, groundedAssistantScore);
    return {
        supported: userOrToolScore >= 0.42 || groundedAssistantScore >= 0.6,
        bestScore,
        groundedAssistantScore,
        userOrToolScore,
    };
}
function sanitizeResolvedTaskPhase(phase, verificationScore, resolutionSupport, fallbackPhase, chunks) {
    if (phase !== "validated" && phase !== "resolved") {
        return phase;
    }
    const toolCount = chunks.filter((chunk) => chunk.role === "tool").length;
    if (resolutionSupport?.supported) {
        return phase;
    }
    if (verificationScore >= 0.72 && toolCount > 0) {
        return phase;
    }
    if (fallbackPhase === "proposed") {
        return toolCount > 0 ? "attempting" : "investigating";
    }
    if (fallbackPhase === "validated" || fallbackPhase === "resolved") {
        return toolCount > 0 ? "attempting" : "investigating";
    }
    return fallbackPhase;
}
function shouldUseHeuristicTaskSummary(chunks) {
    if (chunks.length === 0) {
        return true;
    }
    const totalChars = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
    const toolCount = chunks.filter((chunk) => chunk.role === "tool").length;
    if (toolCount === 0 && chunks.length <= 4 && totalChars <= 1600) {
        return true;
    }
    if (toolCount === 0 && chunks.length <= 6 && totalChars <= 1000) {
        return true;
    }
    return false;
}
function judgeNewTopicHeuristically(currentContext, newMessage) {
    if (!currentContext.trim() || !newMessage.trim()) {
        return null;
    }
    const contextProject = parseWorkflowState(currentContext);
    const nextProject = parseWorkflowState(newMessage);
    if (contextProject?.key === "project.active_project" &&
        nextProject?.key === "project.active_project" &&
        typeof contextProject.value.project === "string" &&
        typeof nextProject.value.project === "string" &&
        contextProject.value.project.trim().toLowerCase() !==
            nextProject.value.project.trim().toLowerCase()) {
        return true;
    }
    const continuity = basicSemanticSimilarity(currentContext, newMessage);
    return continuity < 0.12;
}
function buildChunkPrompt(text, role = "user") {
    return {
        system: '你负责为记忆存储总结一段对话片段。请只返回严格 JSON：{"summary": string}。summary 必须简短、客观、可检索，且不超过 180 个字符。若片段来自 assistant，优先概括可验证结论、决策或结果，不要复述长教程、示例代码或文件操作细节。',
        user: `片段角色：${role}\n\n对话片段：\n${truncateText(text, 5000)}`,
    };
}
function buildTaskPrompt(chunks) {
    const transcript = chunks
        .map((chunk, index) => `${index + 1}. [${chunk.role}] ${renderTaskPromptChunk(chunk, chunks)}`)
        .join("\n");
    return {
        system: '你负责为记忆调度总结一个对话任务。请只返回严格 JSON：{"title": string, "summary": string, "project"?: string, "currentTask"?: string, "nextAction"?: string, "blocker"?: string, "taskPhase"?: "investigating"|"proposed"|"attempting"|"validated"|"resolved"|"reopened", "candidateResolution"?: string, "closureScore"?: number, "verificationScore"?: number, "contradictionRisk"?: number, "eventType"?: string, "eventSummary"?: string, "evidenceChunkIndexes"?: number[]}。taskPhase 描述当前任务所处阶段。只有当转录已经形成比较稳定的结果总结时，才填写 candidateResolution 或 eventSummary。只有在 eventSummary 直接得到 transcript 支撑时，才填写 evidenceChunkIndexes。优先依据 user 与 tool 证据；assistant 的长解释、教程、草稿和文件操作只算辅助上下文，除非它们被 user 或 tool 明确支撑，否则不要让它们主导 title、summary、currentTask、nextAction 或 candidateResolution。不要臆测问题已经解决。',
        user: `对话转录：\n${transcript}`,
    };
}
function buildTaskSummaryEvidencePrompt(evidence) {
    const transcript = evidence.chunks.length > 0
        ? evidence.chunks
            .slice(-16)
            .map((chunk, index) => `${index + 1}. [${chunk.role}] ${renderTaskPromptChunk(chunk, evidence.chunks)}`)
            .join("\n")
        : "无";
    const eventBlock = evidence.linkedEvents.length > 0
        ? evidence.linkedEvents
            .map((event, index) => `${index + 1}. [${event.eventType}] ${truncateText(event.summary, 220)} @ ${event.observedAt}`)
            .join("\n")
        : "无";
    const structuredContext = {
        ...(evidence.project ? { project: evidence.project } : {}),
        ...(evidence.currentTask ? { currentTask: evidence.currentTask } : {}),
        ...(evidence.nextAction ? { nextAction: evidence.nextAction } : {}),
        ...(evidence.blocker ? { blocker: evidence.blocker } : {}),
        ...(evidence.candidateResolution ? { candidateResolution: evidence.candidateResolution } : {}),
        ...(evidence.candidateResolutionPhase
            ? { candidateResolutionPhase: evidence.candidateResolutionPhase }
            : {}),
        ...(evidence.candidateResolutionEvidenceChunkIds.length > 0
            ? { candidateResolutionEvidenceChunkIds: evidence.candidateResolutionEvidenceChunkIds }
            : {}),
        ...(evidence.lastEmittedOutcomeKey
            ? { lastEmittedOutcomeKey: evidence.lastEmittedOutcomeKey }
            : {}),
        ...(evidence.compilerTaskSummary
            ? {
                compilerTaskSummary: evidence.compilerTaskSummary.summary,
                ...(typeof evidence.compilerTaskSummary.confidence === "number"
                    ? { compilerTaskSummaryConfidence: evidence.compilerTaskSummary.confidence }
                    : {}),
            }
            : {}),
        supportRefs: evidence.supportRefs,
    };
    return {
        system: [
            "你负责基于任务证据集重算一个稳定摘要（stable task summary）。",
            "你只能返回严格 JSON，不得输出任何解释文字，不得输出 markdown。",
            '返回格式必须是 {"title": string, "summary": string, "project"?: string, "currentTask"?: string, "nextAction"?: string, "blocker"?: string, "taskPhase"?: "investigating"|"proposed"|"attempting"|"validated"|"resolved"|"reopened", "candidateResolution"?: string, "closureScore"?: number, "verificationScore"?: number, "contradictionRisk"?: number, "eventType"?: string, "eventSummary"?: string, "evidenceChunkIndexes"?: number[]}。',
            "这是 evidence-backed recompute，不是润色旧 heuristic summary。",
            "优先依据 transcript、tool 结果、structured task metadata、candidateResolution、linked events；不要把旧 task.summary 当主输入。",
            "不要发明新的事实、项目名、时间点、关系、解决结果或 outcome。",
            "只有当 transcript 已经支撑比较稳定的结果总结时，才填写 candidateResolution 或 eventSummary。",
            "只有在 eventSummary 直接得到 transcript 支撑时，才填写 evidenceChunkIndexes。",
            "summary 必须客观、稳定、便于 UI/检索；不要写成提问、计划口号或泛化策略。",
            "只输出 JSON。",
        ].join("\n"),
        user: [
            `taskId: ${evidence.taskId}`,
            `structuredContext: ${truncateText(JSON.stringify(structuredContext), 1800)}`,
            `linkedEvents:\n${eventBlock}`,
            `evidenceTranscript:\n${transcript}`,
        ].join("\n\n"),
    };
}
function buildTaskSummaryEvidenceBatchPrompt(evidenceSets) {
    const taskBlocks = evidenceSets
        .map((evidence, index) => {
        const transcript = evidence.chunks.length > 0
            ? evidence.chunks
                .slice(-8)
                .map((chunk, chunkIndex) => `${chunkIndex + 1}. [${chunk.role}] ${truncateText(renderTaskPromptChunk(chunk, evidence.chunks), 220)}`)
                .join("\n")
            : "无";
        const linkedEvents = evidence.linkedEvents.length > 0
            ? evidence.linkedEvents
                .slice(0, 6)
                .map((event) => `- [${event.eventType}] ${truncateText(event.summary, 160)} @ ${event.observedAt}`)
                .join("\n")
            : "无";
        return [
            `任务 ${index + 1} | taskId=${evidence.taskId}`,
            evidence.compilerTaskSummary
                ? `Compiler working summary: ${truncateText(evidence.compilerTaskSummary.summary, 160)}`
                : "",
            evidence.candidateResolution
                ? `Candidate resolution: ${truncateText(evidence.candidateResolution, 180)}`
                : "",
            evidence.project ? `Project: ${truncateText(evidence.project, 120)}` : "",
            evidence.currentTask ? `Current task: ${truncateText(evidence.currentTask, 160)}` : "",
            evidence.nextAction ? `Next action: ${truncateText(evidence.nextAction, 160)}` : "",
            evidence.blocker ? `Blocker: ${truncateText(evidence.blocker, 160)}` : "",
            evidence.lastEmittedOutcomeKey
                ? `Last emitted outcome: ${evidence.lastEmittedOutcomeKey}`
                : "",
            `Linked events:\n${linkedEvents}`,
            `Recent chunks:\n${transcript}`,
        ]
            .filter(Boolean)
            .join("\n");
    })
        .join("\n\n");
    return {
        system: '你负责基于任务证据集批量生成 stable task summary。请只返回严格 JSON：{"tasks":[{"taskId":string,"title":string,"summary":string,"project"?:string,"currentTask"?:string,"nextAction"?:string,"blocker"?:string,"taskPhase"?:string,"candidateResolution"?:string,"closureScore"?:number,"verificationScore"?:number,"contradictionRisk"?:number,"eventType"?:string,"eventSummary"?:string,"evidenceChunkIndexes"?:number[]}]}。要求：1) 每个任务都必须基于给定证据重新生成摘要，而不是润色旧摘要；2) 不要编造未被证据支持的 candidateResolution 或 eventSummary；3) 只在 evidence 明确支持时填写 evidenceChunkIndexes。',
        user: taskBlocks || "无任务",
    };
}
function buildTopicPrompt(currentContext, newMessage) {
    return {
        system: '你负责判断新的用户消息是否开启了一个新的对话任务。请只返回严格 JSON：{"isNewTopic": boolean, "reason": string}。只有在主题或任务明显切换时才返回 true。',
        user: `当前任务上下文：\n${truncateText(currentContext, 4000)}\n\n新的用户消息：\n${truncateText(newMessage, 1000)}`,
    };
}
function buildTaskAssignmentPrompt(currentTask, candidates, incomingTurn) {
    const renderTask = (task) => [
        `taskId: ${task.taskId}`,
        `status: ${task.status}`,
        task.isActive ? "isActive: true" : "",
        `title: ${truncateText(task.title, 160)}`,
        `summary: ${truncateText(task.summary, 260)}`,
        `metadata: ${truncateText(JSON.stringify(task.metadataJson), 320)}`,
        task.recentContext ? `recentContext: ${truncateText(task.recentContext, 360)}` : "",
        `updatedAt: ${task.updatedAt}`,
    ]
        .filter(Boolean)
        .join("\n");
    const currentBlock = currentTask ? renderTask(currentTask) : "无";
    const candidateBlock = candidates.length > 0 ? candidates.map(renderTask).join("\n\n") : "无";
    return {
        system: '你负责做任务归属判断。请只返回严格 JSON：{"decision":"continue"|"resume"|"new","targetTaskId"?:string,"confidence":number,"reason":string}。continue 表示继续当前 active task；resume 表示恢复某个候选历史任务；new 表示创建新任务。只有在新一轮消息与某个已有任务明显延续时，才返回 continue 或 resume。若 decision=resume，targetTaskId 必须来自候选列表。',
        user: `当前 active task：\n${currentBlock}\n\n最近任务候选：\n${candidateBlock}\n\n新一轮消息：\n${truncateText(incomingTurn, 1600)}`,
    };
}
function buildAbstractionCandidatePrompt(candidate) {
    return {
        system: '你负责为已经由确定性信号支持的抽象候选做可选 refinement。请只返回严格 JSON：{"summary"?: string, "displayName"?: string, "stage"?: "candidate"|"probationary"|"quarantined", "reason": string}。规则：1) 不能凭空创造新的抽象、证据或关系；2) 只能在当前候选的基础上微调命名、总结或边界阶段；3) 除非证据明显冲突或抽象明显过度，不要返回 quarantined；4) 不要返回 active、decaying 或 superseded；5) displayName 只在 concept_candidate、graph_hypothesis 或 outcome_hypothesis 时填写，控制在 2 到 6 个词；6) summary 必须客观、可检索，并且少于 220 个字符；7) 如果不需要调整，也要返回 reason，但可以省略其他字段。',
        user: [
            `abstractionType: ${candidate.abstractionType}`,
            `semanticKey: ${candidate.semanticKey}`,
            `currentStage: ${candidate.stage}`,
            `confidence: ${candidate.confidence.toFixed(2)}`,
            `usefulnessScore: ${candidate.usefulnessScore.toFixed(2)}`,
            `stabilityScore: ${candidate.stabilityScore.toFixed(2)}`,
            `contradictionScore: ${candidate.contradictionScore.toFixed(2)}`,
            `currentSummary: ${truncateText(candidate.summary, 260)}`,
            `supportContentRefs: ${truncateText(JSON.stringify(candidate.supportContentRefs.slice(0, 8)), 500)}`,
            `supportBeliefIds: ${truncateText(JSON.stringify(candidate.supportBeliefIds.slice(0, 8)), 500)}`,
            `metadata: ${truncateText(JSON.stringify(candidate.metadataJson), 1400)}`,
        ].join("\n"),
    };
}
function buildOutcomePromotionPrompt(params) {
    const evidenceBlock = params.evidenceChunks.length > 0
        ? params.evidenceChunks
            .map((chunk, index) => `${index + 1}. [${chunk.role}] ${truncateText(chunk.content, 420)}`)
            .join("\n")
        : "无";
    return {
        system: '你负责判断一个任务结果总结是否已经足够稳定，可以提升为正式事件记忆。请只返回严格 JSON：{"shouldPromote": boolean, "promotionScore": number, "reason": string}。只有当结果已经形成较稳定的闭环，并且有 transcript 证据支撑，而不是单纯的建议、计划、礼貌回应或未经验证的推测时，才返回 shouldPromote=true。',
        user: `任务：\n` +
            `taskId: ${params.task.taskId}\n` +
            `title: ${truncateText(params.task.title, 160)}\n` +
            `summary: ${truncateText(params.task.summary, 240)}\n` +
            `metadata: ${truncateText(JSON.stringify(params.task.metadataJson), 320)}\n\n` +
            `候选结果事件：\n` +
            `eventType: ${params.proposal.eventType}\n` +
            `phase: ${params.proposal.phase}\n` +
            `summary: ${truncateText(params.proposal.summary, 260)}\n` +
            `closureScore: ${params.proposal.closureScore.toFixed(2)}\n` +
            `verificationScore: ${params.proposal.verificationScore.toFixed(2)}\n` +
            `contradictionRisk: ${params.proposal.contradictionRisk.toFixed(2)}\n` +
            `confidence: ${params.proposal.confidence.toFixed(2)}\n\n` +
            `相关 transcript 证据：\n${evidenceBlock}`,
    };
}
function buildCandidatePolicyPrompt(candidate, config) {
    const hintBlock = JSON.stringify({
        sourceKind: candidate.source.kind,
        eventType: candidate.eventType ?? null,
        toolName: candidate.source.toolName ?? null,
        entities: candidate.structuredHints?.entities ?? [],
        timeHints: candidate.structuredHints?.timeHints ?? [],
        metadata: candidate.metadata ?? {},
    }, null, 2);
    const thresholdBlock = JSON.stringify({
        minSalienceDurable: Number(config.minSalienceDurable.toFixed(2)),
        minSalienceSession: Number(config.minSalienceSession.toFixed(2)),
        minUtilityForGraph: Number(config.minUtilityForGraph.toFixed(2)),
        episodicEventMinSalience: Number(Math.min(config.minSalienceSession, 0.35).toFixed(2)),
    }, null, 2);
    return {
        system: "你负责为单条记忆候选做语义裁决。请只返回严格 JSON：" +
            '{"action":"ignore"|"session_state"|"durable_state"|"stable_fact"|"episodic_event"|"graph_relation",' +
            '"salienceScore":number,"expectedFutureUtility":number,"stabilityScore":number,' +
            '"preference"?:{"predicate":"prefers_"|"uses_"|"has_"|"depends_" + topic,"object":string,"guidance"?:{"guidanceType":"language"|"style"|"charset"|"output_order"|"generic_preference","guidanceText":string},"confidence":number,"reason":string}|null,' +
            '"workflows"?:[{"key":string,"value":object,"stateKind"?:"session"|"durable","confidence":number,"reason":string}],' +
            '"relations"?:[{"subject":string,"predicate":string,"rawPredicate"?:string,"slot"?:string,"object":string,"confidence":number,"reason":string}],' +
            '"relation"?:{"subject":string,"predicate":string,"rawPredicate"?:string,"slot"?:string,"object":string,"confidence":number,"reason":string}|null,' +
            '"decision"?:{"summary":string,"confidence":number,"reason":string}|null,' +
            '"reason":string}。\n\n' +
            "判断规则：\n" +
            "1. ignore：提问、闲聊、无复用价值、缺乏可验证语义\n" +
            "2. session_state/durable_state：工作状态（项目、任务、卡点、下一步）；durable 仅限跨会话值得保留\n" +
            "3. stable_fact：稳定偏好、用户资料、长期约束；如影响回答方式/语言/风格，同时返回 guidance\n" +
            "4. graph_relation：命名实体间明确关系，必须返回 relation 或 relations；一段文本若包含多条明确关系，优先使用 relations。若关系表示项目画像中的组件角色，可附带 slot，例如 broker、primary_db、cache\n" +
            "4.1. 若文本省略了项目主语，但 metadata.currentProject 或 metadata.currentProjectProfile 已明确给出当前项目，可将该项目作为关系或 project.<code> workflow 的主语；若用户表达了替换/迁移/移除组件，优先输出替换后的 components 或 uses[slot] 关系，不要把 action/target/replacement 之类自由文本塞进项目档案\n" +
            "5. episodic_event：一次性结果、执行输出、历史经过\n" +
            "6. 根据整体语义判断，不依赖表面关键词；禁止臆测；workflows.value 排除格式约束和礼貌语\n" +
            "7. preference.predicate 必须以 prefers_/uses_/has_/depends_ 开头，后接下划线连接的名词 topic，例如 prefers_code_style、uses_spring_boot、has_senior_background\n\n" +
            "评分区间：\n" +
            "salienceScore: 0-0.24 忽略 | 0.45-0.71 session | 0.72-1.0 durable\n" +
            "expectedFutureUtility: 0-0.29 极低 | 0.55-0.74 常用 | 0.75-1.0 高复用\n" +
            "stabilityScore: 0-0.34 易变 | 0.60-0.79 稳定 | 0.80-1.0 很稳定\n\n" +
            "边界不清时优先 ignore 或 session_state，不要虚高打分。",
        user: `示例（仅供参考格式）：\n\n` +
            `输入："之后默认给我中英双语回答"\n` +
            `输出：{"action":"stable_fact","salienceScore":0.82,"expectedFutureUtility":0.88,"stabilityScore":0.85,"preference":{"predicate":"prefers_language","object":"bilingual responses","guidance":{"guidanceType":"language","guidanceText":"用户偏好中英双语回答"},"confidence":0.88,"reason":"明确语言偏好"},"reason":"长期回答语言偏好"}\n\n` +
            `输入："我用 Palantir Java 风格，4 空格缩进"\n` +
            `输出：{"action":"stable_fact","salienceScore":0.80,"expectedFutureUtility":0.85,"stabilityScore":0.88,"preference":{"predicate":"prefers_code_style","object":"palantir java style 4-space indent","guidance":{"guidanceType":"generic_preference","guidanceText":"用户使用 Palantir Java 风格，4 空格缩进"},"confidence":0.86,"reason":"代码风格偏好"},"reason":"长期代码风格偏好"}\n\n` +
            `输入："我上个月在 charity event 认识了 Tom，这周想再约他喝咖啡。你觉得合适吗？"\n` +
            `输出：{"action":"graph_relation","salienceScore":0.74,"expectedFutureUtility":0.72,"stabilityScore":0.46,"relations":[{"subject":"user","predicate":"related_to","rawPredicate":"met","object":"Tom","confidence":0.84,"reason":"自然对话里明确提到认识了某个联系人"}],"reason":"同一句里既有提问也有可复用的人际关系；提问部分不应抹掉关系信号"}\n\n` +
            `输入："当前任务是做 retrieval routing，卡点是 graph expansion"\n` +
            `输出：{"action":"session_state","salienceScore":0.62,"expectedFutureUtility":0.55,"stabilityScore":0.38,"workflows":[{"key":"workflow.current_task","value":{"task":"retrieval routing"},"stateKind":"session","confidence":0.78,"reason":"当前任务"},{"key":"workflow.blocker","value":{"blocker":"graph expansion","status":"blocked"},"stateKind":"session","confidence":0.76,"reason":"卡点"}],"reason":"workflow 状态"}\n\n` +
            `输入："帮我记住以下信息——我的项目代号是 Orion，版本号 3.2.1，上线日期是 2025 年 3 月 15 日。"\n` +
            `输出：{"action":"durable_state","salienceScore":0.88,"expectedFutureUtility":0.86,"stabilityScore":0.9,"workflows":[{"key":"project.Orion","value":{"projectCode":"Orion","version":"3.2.1","launchDate":"2025-03-15"},"stateKind":"durable","confidence":0.9,"reason":"项目画像主档案"}],"reason":"长期项目画像信息"}\n\n` +
            `输入："Orion 项目用的数据库是 MongoDB，消息队列是 RabbitMQ，缓存是 Redis。"\n` +
            `输出：{"action":"graph_relation","salienceScore":0.86,"expectedFutureUtility":0.84,"stabilityScore":0.88,"relations":[{"subject":"Orion","predicate":"uses","slot":"primary_db","object":"MongoDB","confidence":0.9,"reason":"项目数据库"},{"subject":"Orion","predicate":"uses","slot":"broker","object":"RabbitMQ","confidence":0.9,"reason":"项目消息队列"},{"subject":"Orion","predicate":"uses","slot":"cache","object":"Redis","confidence":0.9,"reason":"项目缓存"}],"reason":"项目组件画像"}\n\n` +
            `输入："我们已经把 RabbitMQ 换成 Kafka 了。"\n` +
            `上下文元数据：{"currentProject":"Orion","currentProjectProfile":{"projectCode":"Orion","components":{"broker":"RabbitMQ","primary_db":"MongoDB","cache":"Redis"}}}\n` +
            `输出：{"action":"durable_state","salienceScore":0.84,"expectedFutureUtility":0.83,"stabilityScore":0.82,"workflows":[{"key":"project.Orion","value":{"projectCode":"Orion","components":{"broker":"Kafka"}},"stateKind":"durable","confidence":0.88,"reason":"当前项目的 broker 已替换"}],"relations":[{"subject":"Orion","predicate":"uses","slot":"broker","object":"Kafka","confidence":0.87,"reason":"当前项目消息队列已更新"}],"reason":"项目组件替换更新"}\n\n` +
            `输入："api gateway 依赖 db router，而 db router 又依赖 primary db"\n` +
            `输出：{"action":"graph_relation","salienceScore":0.78,"expectedFutureUtility":0.79,"stabilityScore":0.74,"relations":[{"subject":"api gateway","predicate":"depends_on","object":"db router","confidence":0.84,"reason":"服务依赖关系"},{"subject":"db router","predicate":"depends_on","object":"primary db","confidence":0.83,"reason":"服务依赖关系"}],"reason":"同一句中包含两条明确依赖关系"}\n\n` +
            `输入："你好，今天天气怎么样？"\n` +
            `输出：{"action":"ignore","salienceScore":0.08,"expectedFutureUtility":0.05,"stabilityScore":0.10,"reason":"闲聊无记忆价值"}\n\n` +
            `---\n\n` +
            `候选文本：\n${truncateText(candidate.rawText, 2000)}\n\n` +
            `当前策略阈值：\n${thresholdBlock}\n\n` +
            `上下文元数据：\n${truncateText(hintBlock, 1800)}`,
    };
}
function buildDedupPrompt(newSummary, sourceText, candidates) {
    const candidateBlock = candidates
        .map((candidate) => [
        `Candidate ${candidate.index}:`,
        `summary: ${truncateText(candidate.summary, 240)}`,
        candidate.text ? `source: ${truncateText(candidate.text, 300)}` : "",
    ]
        .filter(Boolean)
        .join("\n"))
        .join("\n\n");
    return {
        system: '你负责判断记忆去重。请只返回严格 JSON：{"action": "NEW"|"DUPLICATE"|"UPDATE", "targetIndex"?: number, "mergedSummary"?: string, "reason": string}。只有当新片段是在细化已有记忆、并且应该用更好的合并摘要替换旧内容时，才使用 UPDATE。',
        user: `新片段摘要：\n${truncateText(newSummary, 240)}\n\n新片段原文：\n${truncateText(sourceText, 500)}\n\n候选记忆：\n${candidateBlock}`,
    };
}
function buildRelevancePrompt(query, candidates) {
    const candidateBlock = candidates
        .map((candidate) => `${candidate.index}. [${candidate.role}] ${truncateText(candidate.summary, 260)}`)
        .join("\n");
    return {
        system: '你负责过滤召回的记忆候选。请只返回严格 JSON：{"relevant": number[], "sufficient": boolean, "reason": string}。只保留那些对回答当前问题直接有帮助的候选。',
        user: `当前问题：\n${truncateText(query, 500)}\n\n候选记忆：\n${candidateBlock}`,
    };
}
function buildRecallPlanPrompt(query) {
    return {
        system: '你负责判断用户最新请求是否需要调用会话记忆。请只返回严格 JSON：{"shouldRecall": boolean, "focusedQuery": string, "reason": string, "routeHint"?: "workflow"|"factual"|"temporal"|"explanatory"|"mixed"}。如果问题与用户历史、偏好、过去的工作或先前事件无关，就返回 shouldRecall=false。如果 shouldRecall=true，请把用户请求改写成一条简短、聚焦的记忆检索语句。',
        user: `用户最新请求：\n${truncateText(query, 1500)}`,
    };
}
function buildRoutePriorPrompt(query) {
    return {
        system: '你负责为记忆检索选择路由先验。请只返回严格 JSON：{"primaryRoute":"workflow"|"factual"|"temporal"|"explanatory"|"mixed"|"unknown","secondaryRoutes"?: ("workflow"|"factual"|"temporal"|"explanatory")[],"confidence": number,"focusedQueries": {"workflow"?: string,"factual"?: string,"temporal"?: string,"explanatory"?: string},"reason": string}。不要依赖固定关键词模板，而要根据用户真实意图给出每条路由更适合的聚焦检索语句。',
        user: `用户问题：\n${truncateText(query, 1200)}`,
    };
}
function buildRecallPlanWithRoutePrompt(query) {
    return {
        system: '你负责判断用户最新请求是否需要调用会话记忆，并选择路由先验。请只返回严格 JSON：{"shouldRecall": boolean, "focusedQuery": string, "reason": string, "routeHint"?: "workflow"|"factual"|"temporal"|"explanatory"|"mixed", "primaryRoute": "workflow"|"factual"|"temporal"|"explanatory"|"mixed"|"unknown", "secondaryRoutes"?: ("workflow"|"factual"|"temporal"|"explanatory")[], "routeConfidence": number, "focusedQueries": {"workflow"?: string, "factual"?: string, "temporal"?: string, "explanatory"?: string}, "routeReason"?: string}。如果问题与用户历史、偏好、过去的工作或先前事件无关，就返回 shouldRecall=false。如果 shouldRecall=true，请把用户请求改写成一条简短、聚焦的记忆检索语句。同时根据用户真实意图为每条路由给出聚焦检索语句。',
        user: `用户最新请求：\n${truncateText(query, 1500)}`,
    };
}
function buildQueryCompilePrompt(query, fallback) {
    return {
        system: [
            "你负责把一个记忆查询编译成结构化草案（QueryCompileResult）。",
            "你只能返回严格 JSON，不得输出任何解释文字，不得输出 markdown。",
            "顶层字段只能是：queryShape、focusedQuery、answerGranularity、evidenceFidelity、routeWeights、anchors、candidateSurfaces、evidenceGoals、evidencePlan、semanticBridges、answerMode、evidenceCoverage、detailNeedScore、supportNeed、ambiguityLevel、turnMode、compilerProvenance。",
            "你不能发明新的事实、实体、项目名、时间点、关系或结论。",
            "你不能决定最终 recall selection、budget、主证据面、owner、truth。",
            "你的职责只是描述这条 query 的语义形状和它需要什么证据。",
            'queryShape 必须是对象，且只能包含：timeframe("current"|"historical"|"compare"|"timeless")、granularity("summary"|"exact_detail")、referentialMode("anchored"|"deictic")、evidenceNeed("workflow_context"|"canonical_state"|"factual_history"|"event_history"|"relation"|"chunk")。',
            'answerGranularity 只能是 "summary" 或 "detail"。',
            'evidenceFidelity 只能是 "low"、"medium"、"high"。',
            "routeWeights 必须是对象，且只能包含 workflow、factual、temporal、explanatory 四个键；每项是 0 到 1 之间的数字，总和应尽量接近 1。",
            "anchors 必须只来自原始 query 或明确给定的上下文，不能臆造；如果不确定，宁可减少 anchors 并提高 ambiguityLevel。",
            "candidateSurfaces 只能从以下集合中选择：state、fact、event、task、chunk、graph、entity_alias。",
            'evidenceGoals 是可选数组；每项只能包含：goal(string)、positiveQueries(string[])、negativeHints(string[])、focusAnchors(string[])、preferredSurfaces(candidateSurfaces 子集)、fidelity("low"|"medium"|"high")。',
            "evidenceGoals 只描述本次 query 需要哪些证据角色；positiveQueries 是短检索语句，不是用户事实，也不是最终答案。",
            "evidenceGoals 的 focusAnchors 必须来自原始 query 或 focusedQuery，不能发明新实体、新物品、新地点、新时间或新结论。",
            "evidencePlan 是可选对象；只能包含 slots 和 operation。它描述要填哪些证据槽，不是最终答案。",
            'slot 只能包含：id、role、requiredRole、description、subjectHints(string[])、relationHints(string[])、capabilityQueries(string[])、negativeHints(string[])、requiredFields(string[])、preferredLayers、fallbackLayers、minEvidence。role 只能是 "query_context"、"answer_evidence"、"answer_value"、"answer_event"、"time_constraint"、"user_resource"、"prior_advice"、"supporting_context"。requiredRole 只能是 "query_context"、"user_resource"、"prior_advice"、"answer_value"、"answer_event"、"time_constraint"。layers 只能从 state、fact、event、task、chunk、graph、entity_alias、control、strategy、abstraction、belief、snippet 中选。',
            "slot 的 subjectHints 必须来自原始 query 或 focusedQuery；relationHints/requiredFields 只能描述证据角色和证据形态，不得引入新实体、答案值或结论。",
            "semanticBridges 是可选数组；每项只能包含 bridgeId、sourceConcept、role、evidenceShape、retrievalQueries、positiveSignals、negativeSignals、preferredLayers、hypothesisOnly。",
            "semanticBridges 是 evidence contract 的检索假设，不是用户事实。role 只能是 query_context、user_resource、prior_advice、answer_value、answer_event、time_constraint；evidenceShape 只能是 event、attribute_value、resource_affordance、query_context、time_constraint、aggregate_item、causal_explanation、validation_evidence、status_answer、decision_value、availability_statement；hypothesisOnly 必须为 true。",
            "semanticBridges 要把抽象概念翻译成可检索的证据形态。retrievalQueries/positiveSignals 必须是具体证据形态，不要输出 requested topic、query context、matching event、count target 这类模板壳词。",
            "如果 query 询问原因、根因、为什么通过/失败/修复，semanticBridges 应使用 evidenceShape=causal_explanation 描述“真正机制/原因/修复点”，validation_evidence 只能表示测试或验证结果，不能替代原因。",
            "如果 query 询问当前状态、是否仍然 open/active/resolved/completed，semanticBridges 应使用 evidenceShape=status_answer，并把历史诊断、旧 blocker 或只说明验证结果的证据放进 negativeSignals 或 support。",
            "如果 query 是 yes/no、should/can/must/required 这类决策问题，semanticBridges 应使用 evidenceShape=decision_value；结论必须绑定 query_context，不要只检索泛泛的 yes/no 或 required 词。",
            "如果 query 询问 secret/token/password/API key 等敏感值是否可见、真实、存储、提供，semanticBridges 应使用 evidenceShape=availability_statement；可用性/缺失/红acted 证据是答案形态，不要让 raw secret 文本成为检索目标。",
            "如果 query 明确询问之前 assistant 的回答、建议、推荐、说明或曾经告诉用户的内容，evidencePlan 必须包含 role=prior_advice 的 slot，semanticBridges 也应使用 role=prior_advice；不要让下游靠 query 字面词判断 assistant-authored evidence 是否可作为答案。",
            "如果 query 包含抽象领域词，要写成熟的概念桥接。例如 business milestone 可桥接到 signed contract、first client、first revenue、launch、funding；这些只是检索假设，不表示用户一定有这些事实。",
            "semanticBridges 禁止输出具体答案值、地点、人名、数字、学校、球队等，除非原始 query 已经明确包含。不要把桥接词写成最终答案，也不要把桥接词写入 anchors。",
            "如果 query 是建议、推荐、tips、should I 这类需要个性化建议的问题，operation.type 应该倾向 tailor_advice。",
            'tailor_advice 应输出 2 到 3 个 slots：role="query_context" 表示当前问题，role="user_resource" 表示历史里可改变建议的用户资源/能力/约束，role="prior_advice" 表示历史建议或策略。不要把这三类混成一个笼统 slot。',
            "tailor_advice 的 evidenceGoals 应按这些证据角色拆分。positiveQueries 是检索语句，可以写“为了当前问题，寻找用户拥有/可用/受限的相关资源”这类语义，但不能写成用户已经拥有某个具体资源，除非原 query 已明确说出。",
            "tailor_advice 的 user_resource slot 必须把当前问题改写成所需能力、约束或使用场景；不要只写 tips、advice、current need、prior context 这类壳词。",
            "tailor_advice 的 capabilityQueries 必须描述“需要什么能力/资源/限制来帮助当前问题”，例如围绕续航问题可写补电、减少耗电、充电能力这类功能需求；它们只是检索 hint，不是用户事实，也不是最终答案。",
            "capabilityQueries 可以包含从问题自然推出的功能、约束、使用场景或方法类别，但不能写成用户已经拥有某个具体资源，除非原 query 已明确说出。",
            "tailor_advice 的 semanticBridges 应把当前问题桥接为 user_resource/prior_advice 可检索形态，例如“能帮助当前设备续航的资源或限制”“历史里与减少耗电/补电有关的建议”，但不要断言用户拥有某个物品。",
            'count_aggregate 必须至少拆出 role="answer_event" 的可计数事件槽和 role="time_constraint" 的时间约束槽；不能只输出一个 primary slot，也不能把 attended、hosted、went to、past month 这类泛动词/时间词当答案证据。',
            "count_aggregate 的 semanticBridges 应把 count target 桥接成多个独立事件证据形态；positiveSignals 必须包含 count target 的领域名词，时间窗口只是约束，不是答案本体。",
            'temporal query 必须区分 role="time_constraint"、role="query_context" 和 role="answer_value"；时间相似只是约束，不能替代答案主题或答案值。',
            "temporal query 的 semanticBridges 应把抽象主题桥接成可能的领域证据形态，同时把时间约束作为单独 time_constraint 信号。",
            'attribute_lookup / return_value query 应区分 role="query_context" 的主题约束和 role="answer_value" 的直接答案证据。answer_value 必须能绑定 query_context；例如 planning to stay 不能脱离 birthday trip to Hawaii 单独成为强答案。',
            "条件型 return_value/attribute_lookup query（例如“X 对 Y 是否必须/允许/足够/适用”）必须把 Y 放进 query_context，把 X 的结论放进 answer_value。semanticBridges 的 negativeSignals 应描述会改变答案的对照条件或不适用条件；例如 query 问 helper-only/unit-helper 时，runtime output、import boundary、packaging、published surface 这类不同条件只能作为 negativeSignals/contrast，不应替代 helper-only 条件。",
            "negativeSignals 只能表示“不同上下文/不同条件/不适用领域”的对照信号，不能表示可能的答案极性。比如 optional、not required、not mandatory、skip build 这类可能就是正确答案，不能放进 negativeSignals；如果它们与 query_context 绑定，应作为 answer_value 的正向答案证据。",
            "条件型 query 里，证据只命中动作词或结论词（例如 build required），但没有绑定 query_context（例如 helper-only unit fix）时，只能作为弱候选；你的 evidencePlan/semanticBridges 要让下游能区分“同一条件下的答案”和“另一个条件下的答案”。",
            'operation 只能包含 type 和 description；type 只能是 "return_value"、"aggregate"、"derive"、"compare"、"relate"、"tailor_advice" 之一。',
            "多事件、比较、时间间隔、差值、先后关系这类 query 必须输出多个 slots；每个事件/对象/比较边各占一个 slot，不能用一个笼统 primary slot 代替。",
            'answerMode 只能是 "single_fact"、"attribute_lookup"、"count_aggregate"、"multi_evidence"。',
            "evidenceCoverage 是兼容字段，只描述答案证据的软评分锚点；只能包含 requiredAnchors(string[])、optionalAnchors(string[])、minProtectedItems(number)、maxProtectedItems(number)。min/max 只是软预算提示，不是注入硬门槛。",
            "requiredAnchors 必须是问题里的真实主题/属性锚点，不要输出 Question、How many do、How much time do 这类问句壳子。",
            "detailNeedScore、supportNeed、ambiguityLevel 都必须是 0 到 1 之间的数字。",
            'turnMode 只能是 "memory_qa"、"workspace_task"、"mixed"。',
            'compilerProvenance 固定输出 {"source":"llm"}；其余 provenance 由运行时覆盖。',
            "focusedQuery 只能做保守重写、消歧和压缩，不得引入 query 中不存在的新实体、新时间、新对比项或新结论。",
            "保守策略：如果不确定，不要补全；提高 ambiguityLevel，减少 anchors，降低 evidenceFidelity 或 supportNeed。",
            "简短回答 + 高证据保真度是合法组合。",
            "只输出 JSON。",
        ].join("\n"),
        user: `原始查询：\n${truncateText(query, 1200)}\n\n当前 deterministic 草案：\n${JSON.stringify(fallback, null, 2)}`,
    };
}
function buildTurnSemanticCompilePrompt(messages, fallback) {
    const messageBlock = messages
        .map((message, index) => `${index + 1}. role=${message.role} sourceRef=${message.sourceRef || `${message.role}:${message.turnId}`}\n${truncateText(message.content, 400)}`)
        .join("\n\n");
    const compactFallback = summarizeTurnSemanticFallback(fallback);
    return {
        system: [
            "你负责把一个对话轮次编译成语义草案（TurnSemanticFrame）。",
            "你只能返回严格 JSON，不得输出任何解释文字，不得输出 markdown。",
            "顶层字段只能是：sourceRefs、chunkDrafts、taskProposal、assertionDrafts、correctionDrafts、relationDrafts、resourceAssertions、adviceSignals、supportSpans、compilerProvenance。",
            "这是对当前轮次的语义编译结果。deterministic 草案只用于提供 sourceRef、chunk/task scaffold 和审计参考，不是语义 truth。",
            "semantic 字段必须由你显式输出：assertionDrafts、correctionDrafts、relationDrafts、resourceAssertions、adviceSignals 如果没有高价值内容就省略或返回空数组；运行时不会把 deterministic regex 语义自动补回来。",
            "chunkDrafts、taskProposal、supportSpans 可以省略；省略时运行时会保留 deterministic scaffold。",
            "不要把输入文本、长句子或大段摘要复制进输出；输出应该尽可能短。",
            "这只是 semantic draft，不是最终写库动作。",
            "你不能输出 final action、classification、owner、supersede、slotReplacement。",
            "你不能直接决定 durable state/fact/event/graph relation，也不能改写 canonical truth。",
            "sourceRefs 必须是数组，且只能引用输入里已有的 sourceRef，不能发明新的 sourceRef。",
            "chunkDrafts 只在 deterministic 草案明显错了时才允许返回；每个 chunkDraft 只允许 sourceRef 和一个不超过 24 个字符的 summary。",
            'taskProposal 只能表达任务连续性的草案；如果返回 taskProposal，必须把整个对象一起返回。decision 只能是 "continue"|"resume"|"new"|"none"，允许字段 targetTaskId、confidence、summary、summaryConfidence、reason；summary 只是一条 working summary 草案，不是事实 owner，也不是最终 assignment。',
            'assertionDrafts 只能表达 semantic hint，不能表达 final canonical class；familyHint 只能是 "workflow"|"preference"|"fact_like"|"event_like"|"relation_like"|"strategy_like"，timeframeHint 只能是 "current"|"historical"|"compare"|"timeless"。strategy_like 只用于步骤顺序、排查原则、程序化 guidance，不代表新增 durable schema。默认只返回 sourceRef、familyHint、timeframeHint、slotHints、confidence，不要返回 entityHints 或 supportSpans，除非 deterministic 草案明显错了。',
            "不要把 assertionDrafts 写成 final state/fact/event/relation action。",
            'relationDrafts 用于明确实体关系，每项必须包含 sourceRef、relation、confidence。relation 只能包含 subject、predicate、object、polarity、rawPredicate、slot/relationSlot、confidence、reason；polarity 必须是 affirmed 或 negated。只有 affirmed 表示可写入正向 graph edge；negated 表示“该关系不成立/负向边界”，只能作为证据支持，不能写成正向 edge。subject/object 必须来自当前轮文本或已给上下文元数据，不得臆测；predicate 必须表达真实关系，例如 uses、depends_on、blocks、owner_of、part_of、supersedes、contradicts、resolved_by、reads、related_to。关系不是 final action，但它是 graph 写入的结构化输入。',
            "relationDrafts 的 subject/object 必须是可稳定复现的具名项目、模块、文件、工具、人、组织、资源或地点；不要把“这/它/that/it/this/上面的问题/这个偏好”等代词、泛指词、句子片段或纯概念标签当 entity。若只能看到代词但无法从本轮或上下文元数据解析到稳定实体，请省略 relationDraft。",
            "关系方向必须按 predicate contract 输出：owner_of 的 subject 永远是负责人/拥有者/owner，object 是被负责的模块、资源、问题域或职责；如果原文是 “X is owned by Y / X 归 Y / X 由 Y 负责”，必须输出 subject=Y, predicate=owner_of, object=X。blocks 的 subject 是 blocker，object 是被阻塞对象。depends_on 的 subject 是依赖方，object 是被依赖方。不确定方向时不要用强关系，改用 related_to 或不输出 relationDraft。",
            "显式 rename / alias / formerly / old-name / 曾用名 / 原名 / 改名 / current name replacement 关系必须用 supersedes，不要降成 related_to。方向固定为当前/新/canonical 名称是 subject，旧/历史/former 名称是 object；例如 “LuoShu, formerly Pine” 输出 subject=\"LuoShu\", predicate=\"supersedes\", object=\"Pine\"。只有文本只是松散关联、没有身份或改名含义时，才使用 related_to。",
            'resourceAssertions 用于用户明确提到自己拥有、刚获得、正在使用、正在考虑的具体资源、工具、账号、服务、能力或约束；每项必须包含 owner、resource、ownershipStatus("owned"|"recently_acquired"|"uses"|"considering")、sourceRef、supportText、confidence、semanticStatus("observed"|"inferred_affordance")，可选 resourceType、domains、affordances。sourceRef 必须来自输入，supportText 必须是原文短摘且少于 160 字符。domains/affordances 是短检索提示，用来说明这个资源通常解决什么问题或提供什么能力；如果这层推断并非原文直说，semanticStatus 用 "inferred_affordance"，且不要把它写成用户事实。不要把纯推荐列表、assistant 建议、第三方反应、效果指标、抽象主题或泛化产品知识当成用户资源。',
            'adviceSignals 用于同一轮里有用户问题上下文、用户资源、assistant 建议或可复用建议上下文的情况；每项只能包含 problemContext、userResources、assistantRecommendation、domains、sourceRefs、supportText、confidence、semanticStatus("observed"|"assistant_suggested")。sourceRefs 必须全部来自输入，必须至少有一个 sourceRef；不要凭空生成 strategy。',
            "一次输出最多 8 个高价值 signals：relationDrafts 最多 4 条，resourceAssertions 最多 3 条，adviceSignals 最多 2 条。优先输出未来 advice/preference/recall 明显有用、且有 sourceRef 的结构化内容。",
            "correctionDrafts 只表达纠偏草案，不做最终物化；每项只需要 sourceRef、correction、confidence。correction 本身只应在文本里明确出现 current/historical change cue 时输出；priorValue 和 nextValue 只写简短短语，不要复制整句；运行时会自动补 lineage。",
            "supportSpans 默认不要返回；只有 deterministic 草案把 sourceRef 绑定错了时才允许返回，而且 text 必须是很短的精确子串。",
            'compilerProvenance 可以省略；如果返回它，只允许 {"source":"llm"}；其余 provenance 由运行时覆盖。',
            "保守策略：纯提问、假设、条件句、引用第三方内容，不要输出高置信 assertionDraft。",
            "如果一句话是否构成 assertion 不确定，宁可降低 confidence，或不输出对应 assertionDraft。",
            "一条 source 可以产出多个 assertionDraft，但不要为了看起来完整而补造草案；整个输出里 assertionDraft 最多 2 条，correctionDraft 最多 1 条。",
            "如果本轮没有值得写入的语义信号，可以返回 {}；这表示没有 compiler-confirmed semantic signals，不表示接受 deterministic semantic hints。",
            "只输出 JSON。",
        ].join("\n"),
        user: `当前轮次消息：\n${messageBlock}\n\n当前 deterministic 草案摘要：\n${JSON.stringify(compactFallback, null, 2)}`,
    };
}
function hasRecognizedTurnSemanticPatch(value) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
        return true;
    }
    const allowed = new Set([
        "sourceRefs",
        "chunkDrafts",
        "taskProposal",
        "assertionDrafts",
        "correctionDrafts",
        "relationDrafts",
        "resourceAssertions",
        "adviceSignals",
        "supportSpans",
        "compilerProvenance",
    ]);
    return keys.some((key) => allowed.has(key));
}
function summarizeTurnSemanticFallback(fallback) {
    const draftsBySource = new Map();
    for (const draft of fallback.assertionDrafts) {
        const current = draftsBySource.get(draft.sourceRef) ?? {
            sourceRef: draft.sourceRef,
            families: [],
            timeframes: [],
            slots: [],
            hasCorrection: false,
        };
        if (!current.families.includes(draft.familyHint)) {
            current.families.push(draft.familyHint);
        }
        if (!current.timeframes.includes(draft.timeframeHint)) {
            current.timeframes.push(draft.timeframeHint);
        }
        for (const slot of draft.slotHints ?? []) {
            if (!current.slots.includes(slot)) {
                current.slots.push(slot);
            }
        }
        draftsBySource.set(draft.sourceRef, current);
    }
    for (const correction of fallback.correctionDrafts) {
        const current = draftsBySource.get(correction.sourceRef) ?? {
            sourceRef: correction.sourceRef,
            families: [],
            timeframes: [],
            slots: [],
            hasCorrection: false,
        };
        current.hasCorrection = true;
        current.correctionTimeframe = correction.correction.timeframe;
        draftsBySource.set(correction.sourceRef, current);
    }
    for (const relation of fallback.relationDrafts ?? []) {
        const current = draftsBySource.get(relation.sourceRef) ?? {
            sourceRef: relation.sourceRef,
            families: [],
            timeframes: [],
            slots: [],
            hasCorrection: false,
        };
        if (!current.families.includes("relation_like")) {
            current.families.push("relation_like");
        }
        const slot = relation.relation.relationSlot ?? relation.relation.predicate;
        if (slot && !current.slots.includes(slot)) {
            current.slots.push(slot);
        }
        draftsBySource.set(relation.sourceRef, current);
    }
    return {
        sourceRefs: fallback.sourceRefs,
        taskProposal: fallback.taskProposal
            ? {
                decision: fallback.taskProposal.decision,
                targetTaskId: fallback.taskProposal.targetTaskId,
                confidence: fallback.taskProposal.confidence,
                summary: fallback.taskProposal.summary,
                summaryConfidence: fallback.taskProposal.summaryConfidence,
            }
            : undefined,
        semanticHints: [...draftsBySource.values()],
    };
}
function sourceRefForReasonerMessage(message) {
    return message.sourceRef || `${message.role}:${message.turnId}`;
}
function normalizeTurnSemanticDecision(value) {
    return value === "continue" || value === "resume" || value === "new" || value === "none"
        ? value
        : undefined;
}
function normalizeTurnSemanticFamilyHint(value) {
    return value === "workflow" ||
        value === "preference" ||
        value === "fact_like" ||
        value === "event_like" ||
        value === "relation_like" ||
        value === "strategy_like"
        ? value
        : undefined;
}
function normalizeTurnSemanticTimeframeHint(value) {
    return value === "current" ||
        value === "historical" ||
        value === "compare" ||
        value === "timeless"
        ? value
        : undefined;
}
function normalizedStringArray(value, limit) {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set();
    const normalized = [];
    for (const entry of value) {
        if (typeof entry !== "string") {
            continue;
        }
        const text = truncateText(entry.trim(), 80);
        if (!text) {
            continue;
        }
        const key = normalizeText(text);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        normalized.push(text);
        if (normalized.length >= limit) {
            break;
        }
    }
    return normalized;
}
function normalizeResourceOwnershipStatus(value) {
    return value === "owned" ||
        value === "recently_acquired" ||
        value === "uses" ||
        value === "considering"
        ? value
        : undefined;
}
function normalizeResourceSemanticStatus(value) {
    return value === "inferred_affordance" ? "inferred_affordance" : "observed";
}
function normalizeAdviceSemanticStatus(value) {
    return value === "assistant_suggested" ? "assistant_suggested" : "observed";
}
function normalizeResourceAssertions(value, messageIndex) {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const normalized = [];
    const seen = new Set();
    for (const entry of value) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const record = entry;
        const sourceRef = typeof record.sourceRef === "string" ? record.sourceRef.trim() : "";
        const owner = typeof record.owner === "string" && record.owner.trim() ? record.owner.trim() : "user";
        const resource = typeof record.resource === "string" ? record.resource.trim() : "";
        const ownershipStatus = normalizeResourceOwnershipStatus(record.ownershipStatus);
        const supportText = typeof record.supportText === "string" ? truncateText(record.supportText.trim(), 160) : "";
        if (!sourceRef ||
            !messageIndex.has(sourceRef) ||
            !resource ||
            !ownershipStatus ||
            !supportText) {
            continue;
        }
        const key = `${sourceRef}:${normalizeText(owner)}:${normalizeText(resource)}:${ownershipStatus}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        normalized.push({
            owner,
            resource: truncateText(resource, 120),
            ownershipStatus,
            ...(typeof record.resourceType === "string" && record.resourceType.trim()
                ? { resourceType: truncateText(record.resourceType.trim(), 80) }
                : {}),
            domains: normalizedStringArray(record.domains, 5),
            affordances: normalizedStringArray(record.affordances, 5),
            sourceRef,
            supportText,
            confidence: typeof record.confidence === "number" && Number.isFinite(record.confidence)
                ? clamp01(record.confidence)
                : 0.65,
            semanticStatus: normalizeResourceSemanticStatus(record.semanticStatus),
        });
        if (normalized.length >= 3) {
            break;
        }
    }
    return normalized.length > 0 ? normalized : undefined;
}
function normalizeAdviceSignals(value, messageIndex) {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const normalized = [];
    const seen = new Set();
    for (const entry of value) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const record = entry;
        const sourceRefs = normalizedStringArray(record.sourceRefs, 4).filter((sourceRef) => messageIndex.has(sourceRef));
        if (sourceRefs.length === 0) {
            continue;
        }
        const problemContext = typeof record.problemContext === "string" && record.problemContext.trim()
            ? truncateText(record.problemContext.trim(), 160)
            : undefined;
        const assistantRecommendation = typeof record.assistantRecommendation === "string" && record.assistantRecommendation.trim()
            ? truncateText(record.assistantRecommendation.trim(), 180)
            : undefined;
        const supportText = typeof record.supportText === "string" && record.supportText.trim()
            ? truncateText(record.supportText.trim(), 160)
            : undefined;
        const userResources = normalizedStringArray(record.userResources, 5);
        const domains = normalizedStringArray(record.domains, 5);
        if (!problemContext && !assistantRecommendation && userResources.length === 0 && !supportText) {
            continue;
        }
        const key = `${sourceRefs.join("|")}:${normalizeText([problemContext, assistantRecommendation, ...userResources].filter(Boolean).join(" "))}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        normalized.push({
            ...(problemContext ? { problemContext } : {}),
            ...(userResources.length > 0 ? { userResources } : {}),
            ...(assistantRecommendation ? { assistantRecommendation } : {}),
            ...(domains.length > 0 ? { domains } : {}),
            sourceRefs,
            ...(supportText ? { supportText } : {}),
            confidence: typeof record.confidence === "number" && Number.isFinite(record.confidence)
                ? clamp01(record.confidence)
                : 0.6,
            semanticStatus: normalizeAdviceSemanticStatus(record.semanticStatus),
        });
        if (normalized.length >= 2) {
            break;
        }
    }
    return normalized.length > 0 ? normalized : undefined;
}
function normalizeCompiledTurnSemanticPatch(messages, patch) {
    const messageIndex = new Map(messages.map((message) => [sourceRefForReasonerMessage(message), message]));
    const withLineage = (sourceRef) => {
        const message = messageIndex.get(sourceRef);
        if (!message) {
            return undefined;
        }
        return {
            sourceKind: "chunk",
            sourceId: message.turnId,
            sourceRef,
        };
    };
    const sourceRefs = Array.isArray(patch.sourceRefs)
        ? patch.sourceRefs.filter((value) => typeof value === "string" && messageIndex.has(value))
        : undefined;
    const chunkDrafts = Array.isArray(patch.chunkDrafts)
        ? patch.chunkDrafts
            .map((entry) => {
            const sourceRef = typeof entry?.sourceRef === "string" ? entry.sourceRef : undefined;
            const summary = typeof entry?.summary === "string" ? entry.summary.trim() : "";
            const lineage = sourceRef ? withLineage(sourceRef) : undefined;
            if (!sourceRef || !summary || !lineage) {
                return null;
            }
            return {
                sourceRef,
                summary: truncateText(summary, 180),
                lineage,
            };
        })
            .filter((entry) => entry !== null)
        : undefined;
    const rawTaskProposal = patch.taskProposal;
    const taskDecision = normalizeTurnSemanticDecision(rawTaskProposal?.decision ?? rawTaskProposal?.action);
    const taskProposal = rawTaskProposal && taskDecision
        ? {
            decision: taskDecision,
            ...(typeof rawTaskProposal.targetTaskId === "string" &&
                rawTaskProposal.targetTaskId.trim()
                ? { targetTaskId: rawTaskProposal.targetTaskId.trim() }
                : {}),
            confidence: typeof rawTaskProposal.confidence === "number" &&
                Number.isFinite(rawTaskProposal.confidence)
                ? clamp01(rawTaskProposal.confidence)
                : 0.6,
            ...(typeof rawTaskProposal.summary === "string" && rawTaskProposal.summary.trim()
                ? { summary: truncateText(rawTaskProposal.summary.trim(), 320) }
                : {}),
            ...(typeof rawTaskProposal.summaryConfidence === "number" &&
                Number.isFinite(rawTaskProposal.summaryConfidence)
                ? { summaryConfidence: clamp01(rawTaskProposal.summaryConfidence) }
                : {}),
            ...(typeof rawTaskProposal.reason === "string" && rawTaskProposal.reason.trim()
                ? { reason: truncateText(rawTaskProposal.reason.trim(), 180) }
                : {}),
        }
        : undefined;
    const assertionDrafts = Array.isArray(patch.assertionDrafts)
        ? patch.assertionDrafts
            .map((entry, index) => {
            const sourceRef = typeof entry?.sourceRef === "string" ? entry.sourceRef : undefined;
            const familyHint = normalizeTurnSemanticFamilyHint(entry?.familyHint);
            const timeframeHint = normalizeTurnSemanticTimeframeHint(entry?.timeframeHint);
            const lineage = sourceRef ? withLineage(sourceRef) : undefined;
            if (!sourceRef || !familyHint || !timeframeHint || !lineage) {
                return null;
            }
            return {
                draftId: typeof entry?.draftId === "string" && entry.draftId.trim()
                    ? entry.draftId.trim()
                    : `${sourceRef}:${familyHint}:${index}`,
                sourceRef,
                familyHint,
                timeframeHint,
                ...(Array.isArray(entry?.entityHints) ? { entityHints: entry.entityHints } : {}),
                ...(Array.isArray(entry?.slotHints)
                    ? {
                        slotHints: entry.slotHints.filter((slot) => typeof slot === "string" && slot.trim().length > 0),
                    }
                    : {}),
                ...(Array.isArray(entry?.supportSpans) ? { supportSpans: entry.supportSpans } : {}),
                ...(typeof entry?.confidence === "number" && Number.isFinite(entry.confidence)
                    ? { confidence: clamp01(entry.confidence) }
                    : {}),
                lineage,
            };
        })
            .filter((entry) => entry !== null)
        : undefined;
    const correctionDrafts = Array.isArray(patch.correctionDrafts)
        ? patch.correctionDrafts
            .map((entry) => {
            const sourceRef = typeof entry?.sourceRef === "string" ? entry.sourceRef : undefined;
            const correction = entry?.correction && typeof entry.correction === "object"
                ? entry.correction
                : undefined;
            const lineage = sourceRef ? withLineage(sourceRef) : undefined;
            if (!sourceRef || !correction || !lineage) {
                return null;
            }
            return {
                sourceRef,
                correction,
                ...(Array.isArray(entry?.supportSpans) ? { supportSpans: entry.supportSpans } : {}),
                ...(typeof entry?.confidence === "number" && Number.isFinite(entry.confidence)
                    ? { confidence: clamp01(entry.confidence) }
                    : {}),
                lineage,
            };
        })
            .filter((entry) => entry !== null)
        : undefined;
    const relationDrafts = Array.isArray(patch.relationDrafts)
        ? (patch.relationDrafts ?? [])
            .map((entry) => {
            if (!entry || typeof entry !== "object") {
                return null;
            }
            const record = entry;
            const sourceRef = typeof record.sourceRef === "string" ? record.sourceRef : undefined;
            const relation = normalizeRelationHint(record.relation);
            const lineage = sourceRef ? withLineage(sourceRef) : undefined;
            if (!sourceRef || !relation || !lineage) {
                return null;
            }
            return {
                sourceRef,
                relation: {
                    ...relation,
                    sourceRef,
                },
                ...(Array.isArray(record.supportSpans)
                    ? { supportSpans: record.supportSpans }
                    : {}),
                confidence: typeof record.confidence === "number" && Number.isFinite(record.confidence)
                    ? clamp01(record.confidence)
                    : (relation.confidence ?? 0.72),
                lineage,
            };
        })
            .filter((entry) => entry !== null)
        : undefined;
    const resourceAssertions = normalizeResourceAssertions(patch.resourceAssertions, messageIndex);
    const adviceSignals = normalizeAdviceSignals(patch.adviceSignals, messageIndex);
    const supportSpans = Array.isArray(patch.supportSpans)
        ? patch.supportSpans
            .map((entry) => {
            const sourceRef = typeof entry?.sourceRef === "string" ? entry.sourceRef : undefined;
            const text = typeof entry?.text === "string" ? entry.text.trim() : "";
            if (!sourceRef || !text || !messageIndex.has(sourceRef)) {
                return null;
            }
            return {
                sourceRef,
                text: truncateText(text, 240),
                ...(typeof entry?.start === "number" ? { start: entry.start } : {}),
                ...(typeof entry?.end === "number" ? { end: entry.end } : {}),
            };
        })
            .filter((entry) => entry !== null)
        : undefined;
    return {
        ...(sourceRefs ? { sourceRefs } : {}),
        ...(chunkDrafts ? { chunkDrafts } : {}),
        ...(taskProposal ? { taskProposal } : {}),
        ...(assertionDrafts ? { assertionDrafts } : {}),
        ...(correctionDrafts ? { correctionDrafts } : {}),
        ...(relationDrafts ? { relationDrafts } : {}),
        ...(resourceAssertions ? { resourceAssertions } : {}),
        ...(adviceSignals ? { adviceSignals } : {}),
        ...(supportSpans ? { supportSpans } : {}),
        ...(patch.compilerProvenance ? { compilerProvenance: patch.compilerProvenance } : {}),
    };
}
function buildRouteEvidencePrompt(query, routeType, candidates) {
    const candidateBlock = candidates
        .map((candidate) => {
        const score = Number.isFinite(candidate.score) ? candidate.score.toFixed(2) : "0.00";
        const confidence = typeof candidate.confidence === "number"
            ? ` confidence=${candidate.confidence.toFixed(2)}`
            : "";
        const observedAt = candidate.observedAt ? ` observedAt=${candidate.observedAt}` : "";
        return `${candidate.index}. [${candidate.role}] score=${score}${confidence}${observedAt} ${truncateText(candidate.summary, 260)}`;
    })
        .join("\n");
    return {
        system: '你负责做记忆路由证据校验。请只返回严格 JSON：{"relevant": number[], "sufficient": boolean, "support": number, "reason": string}。support 取 0 到 1。判断标准不是句子像不像模板，而是这些证据是否真的支持该路由并足以帮助回答问题。',
        user: `用户问题：\n${truncateText(query, 800)}\n\n候选路由：${routeType}\n\n证据候选：\n${candidateBlock || "无候选"}`,
    };
}
function buildConsolidationFactConfirmPrompt(text, preference) {
    return {
        system: '你负责确认一段反复出现的文本是否真的表达了一个稳定的用户偏好或事实。请只返回严格 JSON：{"confirmed": boolean, "reason": string}。只有当文本确实表达了持久的用户偏好、约束或个人资料时，才返回 confirmed=true。如果文本只是临时指令、闲聊、提问或不包含可存储的偏好语义，返回 confirmed=false。',
        user: `原始文本：\n${truncateText(text, 800)}\n\n启发式提取结果：\npredicate: ${preference.predicate}\nobject: ${preference.object}`,
    };
}
function buildConsolidationRelationConfirmPrompt(text, relation) {
    return {
        system: '你负责确认一段反复出现的文本是否真的表达了命名实体之间的明确关系。请只返回严格 JSON：{"confirmed": boolean, "reason": string}。只有当文本确实描述了两个具体实体之间的结构化关系时，才返回 confirmed=true。如果关系提取有误、实体不具体、或原文语义实际上不支持该关系，返回 confirmed=false。',
        user: `原始文本：\n${truncateText(text, 800)}\n\n启发式提取结果：\nsubject: ${relation.subject}\npredicate: ${relation.predicate}\nobject: ${relation.object}`,
    };
}
function buildConsolidationBatchConfirmPrompt(items) {
    const block = items
        .map((item, index) => {
        const details = item.kind === "fact"
            ? [`predicate: ${item.predicate}`, `object: ${item.object}`]
            : [
                `subject: ${item.subject ?? ""}`,
                `predicate: ${item.predicate}`,
                `object: ${item.object}`,
            ];
        return [
            `${index + 1}. id=${item.id} kind=${item.kind}`,
            ...details,
            `supportCount: ${item.supportCount}`,
            item.latestObservedAt ? `latestObservedAt: ${item.latestObservedAt}` : "",
            item.structuredSummaries.length > 0
                ? `structuredEvidence:\n${item.structuredSummaries.map((summary) => `- ${summary}`).join("\n")}`
                : "",
            item.sourceRefs.length > 0
                ? `sourceRefs:\n${item.sourceRefs.map((sourceRef) => `- ${sourceRef}`).join("\n")}`
                : "",
        ]
            .filter(Boolean)
            .join("\n");
    })
        .join("\n\n");
    return {
        system: '你负责批量确认结构化 consolidation 候选。请只返回严格 JSON：{"items":[{"id":string,"decision":"confirm"|"defer"|"reject","reason":string}]}。只能依据给定的结构化证据来判断：confirm 表示证据足够支持晋升；defer 表示证据暂时不足，应等待后续批次；reject 表示结构化候选与证据不符。不要重新解释原始对话文本，不要引入外部常识。',
        user: block || "无候选",
    };
}
function materializeTaskSummaryJudgeResult(evidence, result) {
    const fallback = summarizeTaskHeuristically(evidence.chunks);
    const fallbackPhase = isTaskPhase(fallback.metadataJson.taskPhase)
        ? fallback.metadataJson.taskPhase
        : "investigating";
    const rawTaskPhase = isTaskPhase(result.taskPhase) ? result.taskPhase : fallbackPhase;
    const closureScore = typeof result.closureScore === "number" && Number.isFinite(result.closureScore)
        ? clamp01(result.closureScore)
        : typeof fallback.metadataJson.closureScore === "number"
            ? clamp01(fallback.metadataJson.closureScore)
            : 0;
    const verificationScore = typeof result.verificationScore === "number" && Number.isFinite(result.verificationScore)
        ? clamp01(result.verificationScore)
        : typeof fallback.metadataJson.verificationScore === "number"
            ? clamp01(fallback.metadataJson.verificationScore)
            : 0;
    const contradictionRisk = typeof result.contradictionRisk === "number" && Number.isFinite(result.contradictionRisk)
        ? clamp01(result.contradictionRisk)
        : typeof fallback.metadataJson.contradictionRisk === "number"
            ? clamp01(fallback.metadataJson.contradictionRisk)
            : 0.2;
    const candidateResolution = result.candidateResolution?.trim() || undefined;
    const eventSummary = result.eventSummary?.trim() || undefined;
    const eventType = result.eventType?.trim() || "task_outcome";
    const evidenceChunkIndexes = Array.isArray(result.evidenceChunkIndexes)
        ? result.evidenceChunkIndexes
            .map((value) => typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : NaN)
            .filter((value) => value >= 1 && value <= evidence.chunks.length)
        : [];
    const resolutionSupport = candidateResolution
        ? taskSummaryEvidenceSupport(candidateResolution, evidence.chunks)
        : undefined;
    const eventSupport = eventSummary
        ? taskSummaryEvidenceSupport(eventSummary, evidence.chunks)
        : undefined;
    const taskPhase = sanitizeResolvedTaskPhase(rawTaskPhase, verificationScore, resolutionSupport, fallbackPhase, evidence.chunks);
    const sanitizedCandidateResolution = candidateResolution && resolutionSupport?.supported ? candidateResolution : undefined;
    const sanitizedEventSummary = eventSummary && eventSupport?.supported ? eventSummary : undefined;
    const confidence = clamp01(0.42 * closureScore + 0.38 * verificationScore + 0.2 * (1 - contradictionRisk));
    const canonicalTaskMetadata = sanitizeTaskMetadata({
        ...fallback.metadataJson,
        ...(result.project?.trim() ? { project: result.project.trim() } : {}),
        ...(result.currentTask?.trim() ? { currentTask: result.currentTask.trim() } : {}),
        ...(result.nextAction?.trim() ? { nextAction: result.nextAction.trim() } : {}),
        ...(result.blocker?.trim() ? { blocker: result.blocker.trim() } : {}),
    });
    const metadataJson = {
        ...fallback.metadataJson,
        ...canonicalTaskMetadata,
        taskPhase,
        closureScore,
        verificationScore,
        contradictionRisk,
        ...(sanitizedCandidateResolution ? { candidateResolution: sanitizedCandidateResolution } : {}),
    };
    return {
        title: truncateText(result.title?.trim() || fallback.title, 120),
        summary: truncateText(result.summary?.trim() || fallback.summary, 320),
        metadataJson,
        synthesizedEvent: sanitizedEventSummary
            ? {
                eventType,
                summary: truncateText(sanitizedEventSummary, 320),
                phase: taskPhase,
                closureScore,
                verificationScore,
                contradictionRisk,
                confidence,
                promotionScore: confidence,
                evidenceChunkIndexes,
            }
            : undefined,
    };
}
// -- Query route LLM prompt ---
function buildQueryRoutePrompt(query) {
    return {
        system: '你负责为用户查询选择记忆检索路由类型。请只返回严格 JSON：{"routeType": "workflow"|"factual"|"temporal"|"explanatory"|"mixed"|"unknown", "routeConfidence": number, "reasons": string[]}。workflow 用于问"我在做什么、当前任务、卡点"；factual 用于问"我的偏好、约束、资料"；temporal 用于问"之前发生了什么、历史事件"；explanatory 用于问"为什么、怎么连起来的、依赖关系"。不要依赖固定关键词模板，要理解用户真实意图。',
        user: `用户查询：\n${truncateText(query, 1200)}`,
    };
}
const QUERY_COMPILE_PROMPT_VERSION = "query-compile/v5";
const TURN_SEMANTIC_COMPILE_PROMPT_VERSION = "turn-semantic-compile/v3";
function buildStrategyClusterValidationPrompt(entries) {
    const block = entries
        .map((entry, index) => `${index + 1}. 领域: ${truncateText(entry.domain, 120)}\n   解法: ${truncateText(entry.resolution, 200)}`)
        .join("\n");
    return {
        system: '你负责验证一组任务结果候选是否确实描述了相似的问题解决模式。请只返回严格 JSON：{"valid": boolean, "reason": string}。只有当这些候选描述的问题领域和解决方式有明显共同模式时，才返回 valid=true。如果候选之间差异过大或聚类存在误判，返回 valid=false。',
        user: `候选聚类：\n${block}`,
    };
}
async function callJudgeModel(cfg, prompt, options = {}) {
    const maxTokens = Math.max(128, Math.min(1600, options.maxTokens ?? 800));
    const temperature = typeof options.temperature === "number" ? options.temperature : 0.1;
    if (cfg.provider === "anthropic") {
        const response = await fetch(normalizeAnthropicEndpoint(cfg.baseUrl), {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-api-key": cfg.apiKey ?? "",
                "anthropic-version": "2023-06-01",
                ...(cfg.headers ?? {}),
            },
            body: JSON.stringify({
                model: cfg.model,
                max_tokens: maxTokens,
                temperature,
                system: prompt.system,
                messages: [{ role: "user", content: prompt.user }],
            }),
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
            throw new Error(`anthropic ${response.status}: ${await response.text()}`);
        }
        const json = (await response.json());
        return extractTextContent(json.content);
    }
    if (cfg.provider === "google") {
        const response = await fetch(normalizeGoogleEndpoint(cfg.baseUrl, cfg.model, cfg.apiKey ?? ""), {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...(cfg.headers ?? {}),
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: [{ text: `${prompt.system}\n\n${prompt.user}` }],
                    },
                ],
                generationConfig: {
                    temperature,
                    maxOutputTokens: maxTokens,
                },
            }),
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
            throw new Error(`google ${response.status}: ${await response.text()}`);
        }
        const json = (await response.json());
        return extractTextContent(json.candidates?.[0]?.content?.parts ?? []);
    }
    if (cfg.provider === "ollama") {
        const response = await fetch(normalizeOllamaEndpoint(cfg.baseUrl), {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...(cfg.headers ?? {}),
            },
            body: JSON.stringify({
                model: cfg.model,
                stream: false,
                options: { temperature, num_predict: maxTokens },
                messages: [
                    { role: "system", content: prompt.system },
                    { role: "user", content: prompt.user },
                ],
            }),
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
            throw new Error(`ollama ${response.status}: ${await response.text()}`);
        }
        const json = (await response.json());
        return json.message?.content?.trim() ?? "";
    }
    const endpoint = normalizeOpenAiEndpoint(cfg.baseUrl);
    const headers = {
        "content-type": "application/json",
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        ...(cfg.headers ?? {}),
    };
    const baseBody = {
        model: cfg.model,
        temperature,
        max_tokens: maxTokens,
        messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
        ],
    };
    const parseOpenAiCompatibleResponse = async (response) => {
        if (!response.ok) {
            throw new Error(`openai-compatible ${response.status}: ${await response.text()}`);
        }
        const json = (await response.json());
        return extractTextContent(json.output_text || json.choices?.[0]?.message?.content);
    };
    if (options.jsonMode) {
        const response = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({
                ...baseBody,
                response_format: { type: "json_object" },
            }),
            signal: AbortSignal.timeout(30_000),
        });
        if (response.ok) {
            return parseOpenAiCompatibleResponse(response);
        }
        const detail = await response.text();
        // Some OpenAI-compatible providers reject response_format=json_object; fall back
        // to the plain request instead of treating that capability mismatch as fatal.
        if (response.status !== 400 &&
            response.status !== 404 &&
            response.status !== 422 &&
            response.status !== 500) {
            throw new Error(`openai-compatible ${response.status}: ${detail}`);
        }
    }
    const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(baseBody),
        signal: AbortSignal.timeout(30_000),
    });
    return parseOpenAiCompatibleResponse(response);
}
function guessProvider(baseUrl, api, providerKey) {
    if (api === "anthropic-messages" ||
        /anthropic/i.test(baseUrl) ||
        /anthropic/i.test(providerKey ?? "")) {
        return "anthropic";
    }
    if (api === "google-generative-ai" ||
        /generativelanguage|google/i.test(baseUrl) ||
        /google/i.test(providerKey ?? "")) {
        return "google";
    }
    if (api === "ollama" || /11434|ollama/i.test(baseUrl) || /ollama/i.test(providerKey ?? "")) {
        return "ollama";
    }
    return "openai-compatible";
}
function loadJudgeModelConfig(config, logger) {
    if (!config.advanced.llmClassifierEnabled) {
        return null;
    }
    const cfgPath = process.env.OPENCLAW_CONFIG_PATH?.trim() || path.join(homedir(), ".openclaw", "openclaw.json");
    if (!fs.existsSync(cfgPath)) {
        logger.debug?.(`memory-memx: no config available for LLM reasoner at ${cfgPath}`);
        return null;
    }
    try {
        const raw = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
        const defaults = raw.agents?.defaults;
        const modelEntry = defaults?.model?.primary;
        const requested = config.advanced.llmClassifierModel?.trim() ||
            (typeof modelEntry === "string" ? modelEntry : "");
        if (!requested) {
            return null;
        }
        const providers = (raw.models?.providers ??
            {});
        let providerKey;
        let model = requested;
        if (requested.includes("/")) {
            [providerKey, model] = requested.split("/", 2);
        }
        else if (typeof modelEntry === "string" && modelEntry.includes("/")) {
            [providerKey] = modelEntry.split("/", 2);
        }
        if (!providerKey) {
            providerKey = Object.keys(providers)[0];
        }
        if (!providerKey) {
            return null;
        }
        const providerCfg = providers[providerKey];
        if (!providerCfg) {
            return null;
        }
        const baseUrl = typeof providerCfg.baseUrl === "string" ? providerCfg.baseUrl.trim() : "";
        if (!baseUrl) {
            return null;
        }
        const headers = providerCfg.headers && typeof providerCfg.headers === "object"
            ? Object.fromEntries(Object.entries(providerCfg.headers)
                .map(([key, value]) => [key, resolveSecretLikeString(value)])
                .filter((entry) => Boolean(entry[1])))
            : undefined;
        const provider = guessProvider(baseUrl, typeof providerCfg.api === "string" ? providerCfg.api : undefined, providerKey);
        return {
            configPath: cfgPath,
            provider,
            baseUrl,
            model,
            apiKey: resolveSecretLikeString(providerCfg.apiKey),
            headers,
        };
    }
    catch (error) {
        logger.warn(`memory-memx: failed to load LLM reasoner config (${String(error)})`);
        return null;
    }
}
export class MemxReasoner {
    config;
    logger;
    judgeModel;
    warned = new Set();
    traces = [];
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.judgeModel = loadJudgeModelConfig(config, logger);
    }
    async summarizeChunk(text, role = "user", options = {}) {
        const fallback = summarizeHeuristically(text);
        if (options.allowLlm === false || shouldUseHeuristicChunkSummary(text, role)) {
            this.recordTrace({
                label: "chunk-summary",
                mode: "heuristic",
                provenance: "deterministic",
                detail: options.allowLlm === false
                    ? "Chunk summary stayed on the deterministic hot path."
                    : "Chunk summary stayed on the heuristic fast path.",
                stage: options.stage,
            });
            recordMemoryLlmBudgetCall(options.audit, {
                label: "chunk-summary",
                stage: options.stage ?? "write_hot_path",
                provenance: "deterministic",
                mode: "heuristic",
                detail: options.allowLlm === false
                    ? "chunk-summary hot path forced to heuristic"
                    : "chunk-summary heuristic fast path",
            });
            return fallback;
        }
        const result = await this.callJson("chunk-summary", buildChunkPrompt(text, role), "heuristic", options);
        return truncateText(result?.summary?.trim() || fallback, 180);
    }
    async summarizeTask(chunks, options = {}) {
        const fallback = summarizeTaskHeuristically(chunks);
        if (options.allowLlm === false || shouldUseHeuristicTaskSummary(chunks)) {
            this.recordTrace({
                label: "task-summary",
                mode: "heuristic",
                provenance: "deterministic",
                detail: options.allowLlm === false
                    ? "Task summary stayed on the deterministic hot path."
                    : "Task summary stayed on the heuristic fast path.",
                stage: options.stage,
            });
            recordMemoryLlmBudgetCall(options.audit, {
                label: "task-summary",
                stage: options.stage ?? "write_hot_path",
                provenance: "deterministic",
                mode: "heuristic",
                detail: options.allowLlm === false
                    ? "task-summary hot path forced to heuristic"
                    : "task-summary heuristic fast path",
            });
            return fallback;
        }
        const promptChunks = chunks.slice(-16);
        const result = await this.callJson("task-summary", buildTaskPrompt(promptChunks), "heuristic", options);
        if (!result) {
            return fallback;
        }
        const fallbackPhase = isTaskPhase(fallback.metadataJson.taskPhase)
            ? fallback.metadataJson.taskPhase
            : "investigating";
        const rawTaskPhase = isTaskPhase(result.taskPhase) ? result.taskPhase : fallbackPhase;
        const closureScore = typeof result.closureScore === "number" && Number.isFinite(result.closureScore)
            ? clamp01(result.closureScore)
            : typeof fallback.metadataJson.closureScore === "number"
                ? clamp01(fallback.metadataJson.closureScore)
                : 0;
        const verificationScore = typeof result.verificationScore === "number" && Number.isFinite(result.verificationScore)
            ? clamp01(result.verificationScore)
            : typeof fallback.metadataJson.verificationScore === "number"
                ? clamp01(fallback.metadataJson.verificationScore)
                : 0;
        const contradictionRisk = typeof result.contradictionRisk === "number" && Number.isFinite(result.contradictionRisk)
            ? clamp01(result.contradictionRisk)
            : typeof fallback.metadataJson.contradictionRisk === "number"
                ? clamp01(fallback.metadataJson.contradictionRisk)
                : 0.2;
        const candidateResolution = result.candidateResolution?.trim() || undefined;
        const eventSummary = result.eventSummary?.trim() || undefined;
        const eventType = result.eventType?.trim() || "task_outcome";
        const evidenceChunkIndexes = Array.isArray(result.evidenceChunkIndexes)
            ? result.evidenceChunkIndexes
                .map((value) => typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : NaN)
                .filter((value) => value >= 1 && value <= promptChunks.length)
            : [];
        const resolutionSupport = candidateResolution
            ? taskSummaryEvidenceSupport(candidateResolution, promptChunks)
            : undefined;
        const eventSupport = eventSummary
            ? taskSummaryEvidenceSupport(eventSummary, promptChunks)
            : undefined;
        const taskPhase = sanitizeResolvedTaskPhase(rawTaskPhase, verificationScore, resolutionSupport, fallbackPhase, promptChunks);
        const sanitizedCandidateResolution = candidateResolution && resolutionSupport?.supported ? candidateResolution : undefined;
        const sanitizedEventSummary = eventSummary && eventSupport?.supported ? eventSummary : undefined;
        const confidence = clamp01(0.42 * closureScore + 0.38 * verificationScore + 0.2 * (1 - contradictionRisk));
        const canonicalTaskMetadata = sanitizeTaskMetadata({
            ...fallback.metadataJson,
            ...(result.project?.trim() ? { project: result.project.trim() } : {}),
            ...(result.currentTask?.trim() ? { currentTask: result.currentTask.trim() } : {}),
            ...(result.nextAction?.trim() ? { nextAction: result.nextAction.trim() } : {}),
            ...(result.blocker?.trim() ? { blocker: result.blocker.trim() } : {}),
        });
        const metadataJson = {
            ...fallback.metadataJson,
            ...canonicalTaskMetadata,
            taskPhase,
            closureScore,
            verificationScore,
            contradictionRisk,
            ...(sanitizedCandidateResolution
                ? { candidateResolution: sanitizedCandidateResolution }
                : {}),
        };
        return {
            title: truncateText(result.title?.trim() || fallback.title, 120),
            summary: truncateText(result.summary?.trim() || fallback.summary, 320),
            metadataJson,
            synthesizedEvent: sanitizedEventSummary
                ? {
                    eventType,
                    summary: truncateText(sanitizedEventSummary, 320),
                    phase: taskPhase,
                    closureScore,
                    verificationScore,
                    contradictionRisk,
                    confidence,
                    promotionScore: confidence,
                    evidenceChunkIndexes,
                }
                : undefined,
        };
    }
    async summarizeTaskFromEvidence(evidence, options = {}) {
        if (evidence.chunks.length === 0) {
            return null;
        }
        const result = await this.callJson("task-summary", buildTaskSummaryEvidencePrompt(evidence), "heuristic", options);
        if (!result) {
            return null;
        }
        return materializeTaskSummaryJudgeResult(evidence, result);
    }
    async summarizeTaskEvidenceBatch(evidenceSets, options = {}) {
        const selected = evidenceSets.filter((entry) => entry.chunks.length > 0);
        if (selected.length === 0) {
            return null;
        }
        const result = await this.callJson("task-summary-batch", buildTaskSummaryEvidenceBatchPrompt(selected), "heuristic", options);
        if (!result?.tasks || result.tasks.length === 0) {
            return null;
        }
        const evidenceByTaskId = new Map(selected.map((entry) => [entry.taskId, entry]));
        const summaries = new Map();
        for (const entry of result.tasks) {
            const taskId = typeof entry?.taskId === "string" ? entry.taskId : undefined;
            if (!taskId) {
                continue;
            }
            const evidence = evidenceByTaskId.get(taskId);
            if (!evidence) {
                continue;
            }
            summaries.set(taskId, materializeTaskSummaryJudgeResult(evidence, entry));
        }
        return summaries.size > 0 ? summaries : null;
    }
    async confirmConsolidationBatch(items, options = {}) {
        if (items.length === 0) {
            return null;
        }
        const result = await this.callJson("consolidation-confirm-batch", buildConsolidationBatchConfirmPrompt(items), "degraded", {
            ...options,
            stage: options.stage ?? "maintenance_async",
        });
        if (!result?.items || result.items.length === 0) {
            return null;
        }
        const decisions = new Map();
        for (const item of result.items) {
            const id = typeof item?.id === "string" ? item.id : undefined;
            if (!id) {
                continue;
            }
            const decision = item.decision === "confirm" || item.decision === "defer" || item.decision === "reject"
                ? item.decision
                : undefined;
            if (!decision) {
                continue;
            }
            decisions.set(id, {
                decision,
                ...(typeof item.reason === "string" && item.reason.trim()
                    ? { reason: item.reason.trim() }
                    : {}),
            });
        }
        return decisions.size > 0 ? decisions : null;
    }
    async judgeTaskAssignment(currentTask, candidates, incomingTurn) {
        if (!incomingTurn.trim()) {
            return null;
        }
        const result = await this.callJson("task-assignment", buildTaskAssignmentPrompt(currentTask, candidates, incomingTurn));
        if (!result) {
            return null;
        }
        const decision = result.decision === "continue" || result.decision === "resume" || result.decision === "new"
            ? result.decision
            : undefined;
        if (!decision) {
            return null;
        }
        const allowedTaskIds = new Set(candidates.map((candidate) => candidate.taskId));
        const normalizedTarget = typeof result.targetTaskId === "string" && allowedTaskIds.has(result.targetTaskId)
            ? result.targetTaskId
            : undefined;
        if (decision === "resume" && !normalizedTarget) {
            return null;
        }
        if (decision === "continue" && !currentTask) {
            return null;
        }
        return {
            decision,
            targetTaskId: normalizedTarget,
            confidence: typeof result.confidence === "number" && Number.isFinite(result.confidence)
                ? clamp01(result.confidence)
                : 0.6,
            reason: result.reason?.trim() || "llm task assignment",
        };
    }
    async judgeNewTopic(currentContext, newMessage) {
        const fallback = judgeNewTopicHeuristically(currentContext, newMessage);
        const result = await this.callJson("topic-judge", buildTopicPrompt(currentContext, newMessage));
        if (typeof result?.isNewTopic === "boolean") {
            return result.isNewTopic;
        }
        return fallback;
    }
    async judgeDedup(newSummary, sourceText, candidates) {
        const result = await this.callJson("dedup-judge", buildDedupPrompt(newSummary, sourceText, candidates), "degraded");
        if (!result?.action) {
            return conservativeDedupDecision(newSummary, candidates);
        }
        return {
            action: result.action,
            targetIndex: typeof result.targetIndex === "number" ? result.targetIndex : undefined,
            mergedSummary: result.mergedSummary?.trim(),
            reason: result.reason?.trim() || "llm dedup",
        };
    }
    async filterRelevant(query, candidates) {
        const result = await this.callJson("relevance-filter", buildRelevancePrompt(query, candidates), "degraded");
        if (!result || !Array.isArray(result.relevant)) {
            return conservativeRelevantDecision();
        }
        return {
            relevant: result.relevant.filter((value) => Number.isInteger(value)),
            sufficient: Boolean(result.sufficient),
            reason: result.reason?.trim() || "llm relevance filter",
        };
    }
    async planRecall(query) {
        const fallback = conservativeRecallPlan(query, this.isEnabled() ? "degraded" : "disabled");
        const result = await this.callJson("recall-plan", buildRecallPlanPrompt(query), "degraded");
        if (!result) {
            return fallback;
        }
        const focusedQuery = truncateText(result.focusedQuery?.trim() || fallback.focusedQuery, 160);
        return {
            shouldRecall: typeof result.shouldRecall === "boolean" ? result.shouldRecall : fallback.shouldRecall,
            focusedQuery: focusedQuery || fallback.focusedQuery,
            reason: result.reason?.trim() || fallback.reason,
            routeHint: result.routeHint === "workflow" ||
                result.routeHint === "factual" ||
                result.routeHint === "temporal" ||
                result.routeHint === "explanatory" ||
                result.routeHint === "mixed"
                ? result.routeHint
                : fallback.routeHint,
            judgmentMode: "llm",
        };
    }
    async judgeRoutePrior(query) {
        const fallback = conservativeRoutePrior(query, this.isEnabled() ? "degraded" : "disabled");
        const result = await this.callJson("route-prior", buildRoutePriorPrompt(query), "degraded");
        if (!result) {
            // Hard failure (unparseable/empty LLM response) — stay conservative so retrieve falls back
            // to score-driven evaluation rather than guessing a route from shallow keywords.
            return fallback;
        }
        // When the LLM response is present but lacks a valid primaryRoute (e.g., wrong-shape response,
        // planRecall mock bleeding into route-prior call), derive route from keywords rather than
        // collapsing to "unknown".
        const resolvedPrior = isRouteType(result.primaryRoute) ? null : heuristicRoutePrior(query);
        const primaryRoute = isRouteType(result.primaryRoute)
            ? result.primaryRoute
            : resolvedPrior.primaryRoute;
        const secondaryRoutes = Array.isArray(result.secondaryRoutes)
            ? result.secondaryRoutes.filter((route) => isPrimaryRouteType(route))
            : fallback.secondaryRoutes;
        const focusedQueries = {};
        for (const route of PRIMARY_ROUTE_TYPES) {
            const value = result.focusedQueries?.[route];
            const next = typeof value === "string" && value.trim()
                ? truncateText(value.trim(), 180)
                : (resolvedPrior?.focusedQueries[route] ?? fallback.focusedQueries[route]);
            if (next) {
                focusedQueries[route] = next;
            }
        }
        return {
            primaryRoute,
            secondaryRoutes,
            confidence: typeof result.confidence === "number" && Number.isFinite(result.confidence)
                ? clamp01(result.confidence)
                : (resolvedPrior?.confidence ?? fallback.confidence),
            focusedQueries,
            reason: result.reason?.trim() || resolvedPrior?.reason || fallback.reason,
            judgmentMode: "llm",
        };
    }
    /**
     * Combined single-LLM-call version of planRecall + judgeRoutePrior.
     * Saves one sequential LLM round-trip (~3.7s) by asking a single prompt
     * that covers both recall planning and route prior selection.
     */
    async planRecallWithRoute(query) {
        const planFallback = conservativeRecallPlan(query, this.isEnabled() ? "degraded" : "disabled");
        const routeFallback = conservativeRoutePrior(query, this.isEnabled() ? "degraded" : "disabled");
        const result = await this.callJson("recall-plan-with-route", buildRecallPlanWithRoutePrompt(query), "degraded");
        if (!result) {
            return { plan: planFallback, routePrior: routeFallback };
        }
        // Parse plan portion
        const focusedQuery = truncateText(result.focusedQuery?.trim() || planFallback.focusedQuery, 160);
        const plan = {
            shouldRecall: typeof result.shouldRecall === "boolean" ? result.shouldRecall : planFallback.shouldRecall,
            focusedQuery: focusedQuery || planFallback.focusedQuery,
            reason: result.reason?.trim() || planFallback.reason,
            routeHint: result.routeHint === "workflow" ||
                result.routeHint === "factual" ||
                result.routeHint === "temporal" ||
                result.routeHint === "explanatory" ||
                result.routeHint === "mixed"
                ? result.routeHint
                : planFallback.routeHint,
            judgmentMode: "llm",
        };
        // Parse route prior portion — fall back to heuristic if missing
        const resolvedPrior = isRouteType(result.primaryRoute) ? null : heuristicRoutePrior(query);
        const primaryRoute = isRouteType(result.primaryRoute)
            ? result.primaryRoute
            : resolvedPrior.primaryRoute;
        const secondaryRoutes = Array.isArray(result.secondaryRoutes)
            ? result.secondaryRoutes.filter((route) => isPrimaryRouteType(route))
            : routeFallback.secondaryRoutes;
        const routeFocusedQueries = {};
        for (const route of PRIMARY_ROUTE_TYPES) {
            const value = result.focusedQueries?.[route];
            const next = typeof value === "string" && value.trim()
                ? truncateText(value.trim(), 180)
                : (resolvedPrior?.focusedQueries[route] ?? routeFallback.focusedQueries[route]);
            if (next) {
                routeFocusedQueries[route] = next;
            }
        }
        const routePrior = {
            primaryRoute,
            secondaryRoutes,
            confidence: typeof result.routeConfidence === "number" && Number.isFinite(result.routeConfidence)
                ? clamp01(result.routeConfidence)
                : (resolvedPrior?.confidence ?? routeFallback.confidence),
            focusedQueries: routeFocusedQueries,
            reason: result.routeReason?.trim() ||
                result.reason?.trim() ||
                resolvedPrior?.reason ||
                routeFallback.reason,
            judgmentMode: "llm",
        };
        return { plan, routePrior };
    }
    async compileQuerySemantics(query, fallback, options = {}) {
        const result = await this.callJson("query-compile", buildQueryCompilePrompt(query, fallback), "degraded", {
            ...options,
            maxTokens: Math.min(options.maxTokens ?? 1600, 1600),
            jsonMode: true,
            temperature: 0,
        });
        if (!result) {
            return null;
        }
        return {
            ...result,
            compilerProvenance: {
                source: "llm",
                mode: "llm",
                promptVersion: QUERY_COMPILE_PROMPT_VERSION,
                model: this.judgeModel?.model,
            },
        };
    }
    async compileTurnSemantics(messages, fallback, options = {}) {
        const result = await this.callJson("turn-semantic-compile", buildTurnSemanticCompilePrompt(messages, fallback), "degraded", {
            ...options,
            maxTokens: Math.min(options.maxTokens ?? 1200, 1200),
            jsonMode: true,
            temperature: 0,
        });
        if (!result) {
            return null;
        }
        if (!hasRecognizedTurnSemanticPatch(result)) {
            return null;
        }
        const normalized = normalizeCompiledTurnSemanticPatch(messages, result);
        return {
            ...normalized,
            compilerProvenance: {
                source: "llm",
                mode: "llm",
                promptVersion: TURN_SEMANTIC_COMPILE_PROMPT_VERSION,
                model: this.judgeModel?.model,
            },
        };
    }
    async judgeRouteEvidence(query, routeType, candidates) {
        const fallback = conservativeRouteEvidenceDecision(routeType, this.isEnabled() ? "degraded" : "disabled");
        const result = await this.callJson(`route-evidence:${routeType}`, buildRouteEvidencePrompt(query, routeType, candidates), "degraded");
        if (!result) {
            return fallback;
        }
        const validSupport = typeof result.support === "number" && Number.isFinite(result.support);
        return {
            relevant: Array.isArray(result.relevant)
                ? result.relevant.filter((value) => Number.isInteger(value))
                : fallback.relevant,
            sufficient: typeof result.sufficient === "boolean" ? result.sufficient : fallback.sufficient,
            support: validSupport ? clamp01(result.support) : fallback.support,
            reason: result.reason?.trim() || fallback.reason,
            // When support is missing, signal the caller to use score-driven evaluation instead
            // of trusting a structurally invalid LLM response.
            judgmentMode: validSupport ? "llm" : "degraded",
        };
    }
    async judgeOutcomePromotion(task, proposal, evidenceChunks) {
        const fallback = conservativeOutcomePromotionDecision();
        const result = await this.callJson("outcome-promotion", buildOutcomePromotionPrompt({ task, proposal, evidenceChunks }), "degraded");
        if (!result) {
            return fallback;
        }
        return {
            shouldPromote: typeof result.shouldPromote === "boolean" ? result.shouldPromote : fallback.shouldPromote,
            promotionScore: typeof result.promotionScore === "number" && Number.isFinite(result.promotionScore)
                ? clamp01(result.promotionScore)
                : fallback.promotionScore,
            reason: result.reason?.trim() || fallback.reason,
        };
    }
    async judgeAbstractionCandidate(candidate, options = {}) {
        const result = await this.callJson("abstraction-refinement", buildAbstractionCandidatePrompt(candidate), "heuristic", {
            ...options,
            stage: options.stage ?? "maintenance_async",
        });
        if (!result) {
            return null;
        }
        const summary = typeof result.summary === "string" ? truncateText(result.summary.trim(), 220) : undefined;
        const displayName = typeof result.displayName === "string" && result.displayName.trim()
            ? truncateText(result.displayName.trim(), 80)
            : undefined;
        const stage = isAbstractionCandidateJudgeStage(result.stage) ? result.stage : undefined;
        const reason = result.reason?.trim() || "llm abstraction refinement";
        if (!summary && !displayName && !stage) {
            return { reason };
        }
        return {
            ...(summary ? { summary } : {}),
            ...(displayName ? { displayName } : {}),
            ...(stage ? { stage } : {}),
            reason,
        };
    }
    async judgeCandidatePolicy(candidate, options = {}) {
        const result = await this.callJson("candidate-policy", buildCandidatePolicyPrompt(candidate, this.config), "heuristic", options);
        if (!result || !isMemoryAction(result.action)) {
            return null;
        }
        const workflows = normalizeWorkflowHints(result.workflows);
        const workflow = normalizeWorkflowHint(result.workflow);
        const normalizedWorkflows = workflows.length > 0 ? workflows : workflow ? [workflow] : undefined;
        const relations = normalizeRelationHints(result.relations);
        const relation = normalizeRelationHint(result.relation);
        const normalizedRelations = relations.length > 0 ? relations : relation ? [relation] : undefined;
        return {
            action: result.action,
            salienceScore: typeof result.salienceScore === "number" && Number.isFinite(result.salienceScore)
                ? clamp01(result.salienceScore)
                : undefined,
            expectedFutureUtility: typeof result.expectedFutureUtility === "number" &&
                Number.isFinite(result.expectedFutureUtility)
                ? clamp01(result.expectedFutureUtility)
                : undefined,
            stabilityScore: typeof result.stabilityScore === "number" && Number.isFinite(result.stabilityScore)
                ? clamp01(result.stabilityScore)
                : undefined,
            preference: normalizePreferenceHint(result.preference),
            workflow: normalizedWorkflows?.[0],
            workflows: normalizedWorkflows,
            relation: normalizedRelations?.[0],
            relations: normalizedRelations,
            decision: normalizeDecisionHint(result.decision),
            reason: result.reason?.trim() || "llm candidate policy",
        };
    }
    async confirmConsolidationFact(text, preference, options = {}) {
        const result = await this.callJson("consolidation-fact-confirm", buildConsolidationFactConfirmPrompt(text, preference), "heuristic", {
            ...options,
            stage: options.stage ?? "maintenance_async",
        });
        // null → LLM disabled or failed; trust heuristic as fallback
        return result === null ? true : result.confirmed === true;
    }
    async confirmConsolidationRelation(text, relation, options = {}) {
        const result = await this.callJson("consolidation-relation-confirm", buildConsolidationRelationConfirmPrompt(text, relation), "heuristic", {
            ...options,
            stage: options.stage ?? "maintenance_async",
        });
        // null → LLM disabled or failed; trust heuristic as fallback
        return result === null ? true : result.confirmed === true;
    }
    async judgeQueryRouteWithLlm(query) {
        const result = await this.callJson("query-route", buildQueryRoutePrompt(query));
        if (!result ||
            typeof result.routeType !== "string" ||
            typeof result.routeConfidence !== "number") {
            return null;
        }
        return {
            routeType: result.routeType,
            routeConfidence: clamp01(result.routeConfidence),
            reasons: Array.isArray(result.reasons)
                ? result.reasons.filter((r) => typeof r === "string")
                : ["llm-route"],
        };
    }
    async validateStrategyCluster(entries) {
        const result = await this.callJson("strategy-cluster-validation", buildStrategyClusterValidationPrompt(entries));
        // null → LLM disabled or failed; trust heuristic clustering as fallback
        return result === null ? true : result.valid === true;
    }
    getResolvedJudgeModel() {
        return this.judgeModel
            ? {
                provider: this.judgeModel.provider,
                model: this.judgeModel.model,
            }
            : null;
    }
    getResolvedJudgeConfigPath() {
        return this.judgeModel?.configPath ?? null;
    }
    getTrace() {
        return [...this.traces];
    }
    clearTrace() {
        this.traces = [];
    }
    async runProbeSuite() {
        this.clearTrace();
        const chunkSummary = await this.summarizeChunk("I am working on retrieval routing, graph expansion is still unclear, and the next step is to add replay tests.");
        const task = await this.summarizeTask([
            {
                chunkId: "probe-chunk-1",
                agentId: "probe",
                scope: "agent:probe",
                sessionKey: "probe",
                turnId: "probe-turn-1",
                seq: 0,
                role: "user",
                chunkKind: "message",
                content: "I am working on retrieval routing for the memx plugin.",
                summary: "retrieval routing for memx plugin",
                contentHash: "probe-hash-1",
                dedupStatus: "active",
                mergeCount: 0,
                sourceRef: "user:probe-turn-1",
                createdAt: "2026-03-18T00:00:00.000Z",
                updatedAt: "2026-03-18T00:00:00.000Z",
            },
            {
                chunkId: "probe-chunk-2",
                agentId: "probe",
                scope: "agent:probe",
                sessionKey: "probe",
                turnId: "probe-turn-2",
                seq: 0,
                role: "user",
                chunkKind: "message",
                content: "The blocker is graph expansion and the next action is to add replay tests.",
                summary: "graph expansion blocker and replay tests next",
                contentHash: "probe-hash-2",
                dedupStatus: "active",
                mergeCount: 0,
                sourceRef: "user:probe-turn-2",
                createdAt: "2026-03-18T00:05:00.000Z",
                updatedAt: "2026-03-18T00:05:00.000Z",
            },
        ]);
        const topicDecision = await this.judgeNewTopic("[User] I am working on retrieval routing for memx.\n[User] The blocker is graph expansion.", "Now let's switch to provider onboarding.");
        const dedup = await this.judgeDedup("retrieval routing for memx plugin", "I am working on retrieval routing for memx plugin", [
            {
                index: 1,
                summary: "retrieval routing for memx plugin",
                text: "same topic and same project",
            },
            { index: 2, summary: "provider onboarding flow", text: "different topic" },
        ]);
        const relevant = await this.filterRelevant("what am I doing and what is blocked", [
            { index: 1, summary: "workflow.current_task: retrieval routing", role: "state" },
            { index: 2, summary: "workflow.blocker: graph expansion", role: "state" },
            { index: 3, summary: "user prefers bilingual responses", role: "fact" },
        ]);
        const recallPlan = await this.planRecall("What was I doing and what is blocked?");
        const model = this.getResolvedJudgeModel();
        return {
            enabled: this.isEnabled(),
            resolvedConfigPath: this.getResolvedJudgeConfigPath(),
            provider: model?.provider ?? null,
            model: model?.model ?? null,
            traces: this.getTrace(),
            outputs: {
                chunkSummary,
                taskTitle: task.title,
                taskSummary: task.summary,
                topicDecision,
                dedupAction: dedup?.action ?? null,
                relevant: relevant?.relevant ?? [],
                recallPlan: recallPlan.focusedQuery,
            },
        };
    }
    async callJson(label, prompt, failureMode = "heuristic", options = {}) {
        if (!this.judgeModel) {
            this.recordTrace({
                label,
                mode: "disabled",
                provenance: "deterministic",
                detail: "LLM classifier is disabled or no judge model could be resolved.",
                stage: options.stage,
            });
            recordMemoryLlmBudgetCall(options.audit, {
                label,
                stage: options.stage ?? "write_hot_path",
                provenance: "deterministic",
                mode: "disabled",
                detail: "LLM classifier unavailable; deterministic fallback remained active.",
            });
            return null;
        }
        const promptChars = prompt.system.length + prompt.user.length;
        const estimatedPromptTokens = estimateTokenCount(`${prompt.system}\n${prompt.user}`);
        try {
            const _tLlm0 = performance.now();
            const raw = await callJudgeModel(this.judgeModel, prompt, {
                maxTokens: options.maxTokens,
                jsonMode: options.jsonMode,
                temperature: options.temperature,
            });
            const _tLlm1 = performance.now();
            const elapsedMs = Math.round(_tLlm1 - _tLlm0);
            const responseChars = raw.length;
            const estimatedCompletionTokens = estimateTokenCount(raw);
            this.logger.info?.(`memory-memx: TIMING llm label=${label} stage=${options.stage ?? "unspecified"} elapsed=${elapsedMs.toFixed(0)}ms provider=${this.judgeModel.provider} model=${this.judgeModel.model}`);
            const parsed = parseJsonResponse(raw);
            if (parsed) {
                this.recordTrace({
                    label,
                    mode: "llm",
                    provenance: "llm",
                    detail: "LLM request succeeded and returned parseable JSON.",
                    stage: options.stage,
                    provider: this.judgeModel.provider,
                    model: this.judgeModel.model,
                });
                recordMemoryLlmBudgetCall(options.audit, {
                    label,
                    stage: options.stage ?? "write_hot_path",
                    provenance: "llm",
                    mode: "llm",
                    provider: this.judgeModel.provider,
                    model: this.judgeModel.model,
                    detail: "LLM request succeeded.",
                    promptChars,
                    responseChars,
                    estimatedPromptTokens,
                    estimatedCompletionTokens,
                    estimatedTotalTokens: estimatedPromptTokens + estimatedCompletionTokens,
                    elapsedMs,
                });
                return parsed;
            }
            this.recordTrace({
                label,
                mode: failureMode,
                provenance: "hybrid",
                detail: failureMode === "heuristic"
                    ? `LLM request returned unparsable output; heuristic fallback was used (${summarizeParseFailure(raw)}).`
                    : `LLM request returned unparsable output; the caller degraded conservatively instead of rebuilding semantics heuristically (${summarizeParseFailure(raw)}).`,
                stage: options.stage,
                provider: this.judgeModel.provider,
                model: this.judgeModel.model,
            });
            recordMemoryLlmBudgetCall(options.audit, {
                label,
                stage: options.stage ?? "write_hot_path",
                provenance: "hybrid",
                mode: failureMode,
                provider: this.judgeModel.provider,
                model: this.judgeModel.model,
                detail: failureMode === "heuristic"
                    ? `LLM output was unparsable; heuristic fallback was used (${summarizeParseFailure(raw)}).`
                    : `LLM output was unparsable; caller degraded conservatively (${summarizeParseFailure(raw)}).`,
                promptChars,
                responseChars,
                estimatedPromptTokens,
                estimatedCompletionTokens,
                estimatedTotalTokens: estimatedPromptTokens + estimatedCompletionTokens,
                elapsedMs,
            });
            this.logger.info?.(`memory-memx: PROBE llm-fallback label=${label} stage=${options.stage ?? "unspecified"} reason=unparsable mode=${failureMode} ${summarizeParseFailure(raw)}`);
            return null;
        }
        catch (error) {
            const elapsedMs = undefined;
            const key = `${label}:${this.judgeModel.provider}:${this.judgeModel.model}`;
            if (!this.warned.has(key)) {
                this.warned.add(key);
                this.logger.warn(failureMode === "heuristic"
                    ? `memory-memx: ${label} fell back to heuristics (${String(error)})`
                    : `memory-memx: ${label} degraded conservatively after LLM failure (${String(error)})`);
            }
            this.logger.info?.(`memory-memx: PROBE llm-fallback label=${label} stage=${options.stage ?? "unspecified"} reason=error mode=${failureMode} err=${String(error).slice(0, 120)}`);
            this.recordTrace({
                label,
                mode: failureMode,
                provenance: "hybrid",
                detail: failureMode === "heuristic"
                    ? `LLM request failed and heuristic fallback was used: ${String(error)}`
                    : `LLM request failed; the caller degraded conservatively instead of rebuilding semantics heuristically: ${String(error)}`,
                stage: options.stage,
                provider: this.judgeModel.provider,
                model: this.judgeModel.model,
            });
            recordMemoryLlmBudgetCall(options.audit, {
                label,
                stage: options.stage ?? "write_hot_path",
                provenance: "hybrid",
                mode: failureMode,
                provider: this.judgeModel.provider,
                model: this.judgeModel.model,
                detail: `LLM request failed: ${String(error)}`,
                promptChars,
                responseChars: 0,
                estimatedPromptTokens,
                estimatedCompletionTokens: 0,
                estimatedTotalTokens: estimatedPromptTokens,
                elapsedMs,
            });
            return null;
        }
    }
    recordTrace(entry) {
        this.traces.push({
            ...entry,
            at: new Date().toISOString(),
        });
        if (this.traces.length > 50) {
            this.traces = this.traces.slice(-50);
        }
    }
    isEnabled() {
        return Boolean(this.judgeModel);
    }
}
export function roleLabelForHit(hit) {
    if (typeof hit.metadata.memxDocType === "string") {
        return hit.metadata.memxDocType;
    }
    if (typeof hit.metadata.role === "string") {
        return hit.metadata.role;
    }
    return hit.backend;
}
export function hasStrongSemanticSignal(text) {
    return Boolean(parsePreferenceSignal(text) || parseWorkflowState(text) || parseRelation(text));
}
