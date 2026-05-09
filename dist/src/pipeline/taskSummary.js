import { objectRecord, stableHash, truncateText } from "../support.js";
import { sanitizeTaskMetadata } from "./authority.js";
import { parseWorkflowState, isQuestionLike } from "./semantics.js";
import { assessAssistantChunk } from "./sourceWeighting.js";
function metadataString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function stringSet(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set();
    const ordered = [];
    for (const entry of value) {
        if (typeof entry !== "string" || !entry.trim()) {
            continue;
        }
        const trimmed = entry.trim();
        if (seen.has(trimmed)) {
            continue;
        }
        seen.add(trimmed);
        ordered.push(trimmed);
    }
    return ordered;
}
function normalizeTaskSummarySourceValue(value) {
    if (value === "compiler" || value === "heuristic_fallback" || value === "maintenance_llm") {
        return value;
    }
    if (value === "heuristic") {
        return "heuristic_fallback";
    }
    if (value === "llm") {
        return "maintenance_llm";
    }
    return undefined;
}
function normalizeTaskSummaryQualityValue(value) {
    return value === "working" || value === "stable" ? value : undefined;
}
export function taskSummarySource(metadataJson) {
    return normalizeTaskSummarySourceValue(objectRecord(metadataJson)?.summarySource);
}
export function taskSummaryQuality(metadataJson) {
    return normalizeTaskSummaryQualityValue(objectRecord(metadataJson)?.summaryQuality);
}
export function taskSummarySupportsSemanticConsumers(metadataJson) {
    const source = taskSummarySource(metadataJson);
    return source === "compiler" || source === "maintenance_llm";
}
export function semanticTaskSummaryText(task) {
    return taskSummarySupportsSemanticConsumers(task.metadataJson)
        ? metadataString(task.summary)
        : undefined;
}
export function taskSummaryMetadataFields(params) {
    return {
        summarySource: params.summarySource,
        summaryQuality: params.summaryQuality,
        summaryBasisFingerprint: params.summaryBasisFingerprint,
        summaryUpdatedAt: params.observedAt,
        ...(params.compilerTaskSummary
            ? { compilerTaskSummary: params.compilerTaskSummary }
            : {}),
        ...(typeof params.compilerTaskSummaryConfidence === "number"
            ? { compilerTaskSummaryConfidence: params.compilerTaskSummaryConfidence }
            : {}),
    };
}
function heuristicTaskMetadata(chunks) {
    let project;
    let currentTask;
    let nextAction;
    let blocker;
    for (const chunk of chunks) {
        if (chunk.role !== "user") {
            continue;
        }
        const parsed = parseWorkflowState(chunk.content);
        if (!parsed) {
            continue;
        }
        if (parsed.key === "project.active_project" && typeof parsed.value.project === "string") {
            project = parsed.value.project;
        }
        else if (parsed.key === "workflow.current_task" && typeof parsed.value.task === "string") {
            currentTask = parsed.value.task;
        }
        else if (parsed.key === "workflow.next_action" && typeof parsed.value.step === "string") {
            nextAction = parsed.value.step;
        }
        else if (parsed.key === "workflow.blocker" && typeof parsed.value.blocker === "string") {
            blocker = parsed.value.blocker;
        }
    }
    return sanitizeTaskMetadata({
        ...(project ? { project } : {}),
        ...(currentTask ? { currentTask } : {}),
        ...(nextAction ? { nextAction } : {}),
        ...(blocker ? { blocker } : {}),
    });
}
function summarizeHeuristically(content) {
    const cleaned = content.replace(/\s+/g, " ").trim();
    if (!cleaned) {
        return "";
    }
    const clauses = cleaned
        .split(/[。.!！？?；;\n]/u)
        .map((entry) => entry.trim())
        .filter(Boolean);
    return truncateText((clauses[0] ?? cleaned).replace(/^[-*•\d.)\s]+/u, ""), 180);
}
export function summarizeTaskHeuristically(chunks) {
    const userChunks = chunks.filter((chunk) => chunk.role === "user");
    const assistantChunks = chunks.filter((chunk) => chunk.role === "assistant");
    const groundedAssistantChunks = assistantChunks.filter((chunk) => {
        const assessment = assessAssistantChunk(chunk, chunks);
        return assessment.weight >= 0.6 && assessment.grounding >= 0.22;
    });
    const toolChunks = chunks.filter((chunk) => chunk.role === "tool");
    const latestUser = userChunks.at(-1)?.content ?? chunks.at(-1)?.content ?? "";
    const metadata = heuristicTaskMetadata(chunks);
    const phase = toolChunks.length > 0 && groundedAssistantChunks.length > 0
        ? "attempting"
        : groundedAssistantChunks.length > 0
            ? "proposed"
            : "investigating";
    const title = typeof metadata.project === "string"
        ? String(metadata.project)
        : summarizeHeuristically(userChunks[0]?.content ?? latestUser) || "Conversation task";
    const summaryParts = [];
    if (typeof metadata.currentTask === "string") {
        summaryParts.push(`Current focus: ${metadata.currentTask}`);
    }
    if (typeof metadata.blocker === "string") {
        summaryParts.push(`Blocker: ${metadata.blocker}`);
    }
    if (typeof metadata.nextAction === "string") {
        summaryParts.push(`Next action: ${metadata.nextAction}`);
    }
    if (summaryParts.length === 0) {
        const recents = userChunks
            .slice(-3)
            .map((chunk) => summarizeHeuristically(chunk.content))
            .filter(Boolean);
        summaryParts.push(...recents);
    }
    return {
        title: truncateText(title, 120),
        summary: truncateText(summaryParts.join(" | "), 320),
        metadataJson: {
            ...metadata,
            taskPhase: phase,
            closureScore: 0.18,
            verificationScore: toolChunks.length > 0 ? 0.24 : 0.08,
            contradictionRisk: 0.22,
        },
    };
}
function compilerSummaryFromProposal(taskProposal, existingMetadata) {
    const proposalSummary = metadataString(taskProposal?.summary);
    if (proposalSummary) {
        return {
            summary: proposalSummary,
            ...(typeof taskProposal?.summaryConfidence === "number"
                ? { confidence: taskProposal.summaryConfidence }
                : {}),
        };
    }
    const metadata = objectRecord(existingMetadata);
    const persistedSummary = metadataString(metadata?.compilerTaskSummary);
    if (!persistedSummary) {
        return undefined;
    }
    const confidence = typeof metadata?.compilerTaskSummaryConfidence === "number"
        ? metadata.compilerTaskSummaryConfidence
        : undefined;
    return {
        summary: persistedSummary,
        ...(typeof confidence === "number" ? { confidence } : {}),
    };
}
function isAcceptableCompilerSummary(summary, confidence) {
    const normalized = summary.trim();
    if (!normalized || normalized.length < 12) {
        return false;
    }
    if (isQuestionLike(normalized)) {
        return false;
    }
    if (/^(?:active task|conversation task|当前任务|对话任务)$/iu.test(normalized)) {
        return false;
    }
    if (typeof confidence === "number" && confidence < 0.42) {
        return false;
    }
    return true;
}
function recentSinceIso(now, days) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString();
}
function structuredEventSummary(event) {
    const metadata = objectRecord(event.metadataJson);
    const memxTemporalFacet = objectRecord(metadata?.memxTemporalFacet);
    return (metadataString(memxTemporalFacet?.summary) ??
        metadataString(metadata?.memxStructuredSummary) ??
        event.text);
}
export function computeTaskSummaryBasisFingerprint(params) {
    return stableHash([
        params.taskId,
        ...params.chunkIds,
        params.candidateResolution ?? "",
        params.candidateResolutionPhase ?? "",
        ...(params.candidateResolutionEvidenceChunkIds ?? []),
        params.compilerTaskSummary ?? "",
        typeof params.compilerTaskSummaryConfidence === "number"
            ? params.compilerTaskSummaryConfidence.toFixed(3)
            : "",
        params.project ?? "",
        params.currentTask ?? "",
        params.nextAction ?? "",
        params.blocker ?? "",
        params.lastEmittedOutcomeKey ?? "",
        ...(params.linkedEventIds ?? []),
    ]);
}
export function buildTaskSummaryEvidenceSet(params) {
    const rawMetadata = objectRecord(params.task.metadataJson);
    const canonicalMetadata = sanitizeTaskMetadata(params.task.metadataJson);
    const compilerTaskSummary = compilerSummaryFromProposal(undefined, rawMetadata);
    const candidateResolution = metadataString(rawMetadata?.candidateResolution);
    const candidateResolutionPhase = metadataString(rawMetadata?.candidateResolutionPhase);
    const candidateResolutionEvidenceChunkIds = stringSet(rawMetadata?.candidateResolutionEvidenceChunkIds);
    const lastEmittedOutcomeKey = metadataString(rawMetadata?.lastEmittedOutcomeKey);
    const chunkIds = params.chunks.map((chunk) => chunk.chunkId);
    const chunkIdSet = new Set(chunkIds);
    const recentEvents = params.eventRepo.search({
        agentId: params.task.agentId,
        scopes: [params.task.scope],
        limit: 48,
        since: recentSinceIso(params.now, 21),
        ...(typeof params.readEpoch === "number" ? { readEpoch: params.readEpoch } : {}),
    });
    const linkedEvents = recentEvents
        .filter((event) => {
        const metadata = objectRecord(event.metadataJson);
        if (metadataString(metadata?.taskId) === params.task.taskId) {
            return true;
        }
        const evidenceChunkIds = stringSet(metadata?.evidenceChunkIds);
        if (evidenceChunkIds.some((chunkId) => chunkIdSet.has(chunkId))) {
            return true;
        }
        return event.sourceRef.includes(params.task.taskId);
    })
        .slice(0, 6)
        .map((event) => ({
        eventId: event.eventId,
        eventType: event.eventType,
        summary: structuredEventSummary(event),
        observedAt: event.observedAt,
        sourceRef: event.sourceRef,
    }));
    const supportRefs = [
        `task:${params.task.taskId}`,
        ...chunkIds.map((chunkId) => `chunk:${chunkId}`),
        ...linkedEvents.map((event) => `event:${event.eventId}`),
    ];
    const fingerprint = computeTaskSummaryBasisFingerprint({
        taskId: params.task.taskId,
        chunkIds,
        candidateResolution,
        candidateResolutionPhase,
        candidateResolutionEvidenceChunkIds,
        compilerTaskSummary: compilerTaskSummary?.summary,
        compilerTaskSummaryConfidence: compilerTaskSummary?.confidence,
        project: canonicalMetadata.project,
        currentTask: canonicalMetadata.currentTask,
        nextAction: canonicalMetadata.nextAction,
        blocker: canonicalMetadata.blocker,
        lastEmittedOutcomeKey,
        linkedEventIds: linkedEvents.map((event) => event.eventId),
    });
    return {
        taskId: params.task.taskId,
        chunks: params.chunks,
        ...(compilerTaskSummary ? { compilerTaskSummary } : {}),
        ...(candidateResolution ? { candidateResolution } : {}),
        ...(candidateResolutionPhase ? { candidateResolutionPhase } : {}),
        candidateResolutionEvidenceChunkIds,
        ...(canonicalMetadata.project ? { project: canonicalMetadata.project } : {}),
        ...(canonicalMetadata.currentTask ? { currentTask: canonicalMetadata.currentTask } : {}),
        ...(canonicalMetadata.nextAction ? { nextAction: canonicalMetadata.nextAction } : {}),
        ...(canonicalMetadata.blocker ? { blocker: canonicalMetadata.blocker } : {}),
        ...(lastEmittedOutcomeKey ? { lastEmittedOutcomeKey } : {}),
        linkedEvents,
        supportRefs,
        fingerprint,
    };
}
export function resolveWorkingTaskSummary(params) {
    const fallback = summarizeTaskHeuristically(params.chunks);
    const compilerTaskSummary = compilerSummaryFromProposal(params.taskProposal, params.task.metadataJson);
    const compilerSummary = compilerTaskSummary && isAcceptableCompilerSummary(compilerTaskSummary.summary, compilerTaskSummary.confidence)
        ? compilerTaskSummary.summary
        : undefined;
    const compilerSummaryConfidence = compilerSummary ? compilerTaskSummary?.confidence : undefined;
    const summarySource = compilerSummary ? "compiler" : "heuristic_fallback";
    const summaryBasisFingerprint = computeTaskSummaryBasisFingerprint({
        taskId: params.task.taskId,
        chunkIds: params.chunks.map((chunk) => chunk.chunkId),
        candidateResolution: typeof params.task.metadataJson?.candidateResolution === "string"
            ? params.task.metadataJson.candidateResolution
            : undefined,
        candidateResolutionPhase: typeof params.task.metadataJson?.candidateResolutionPhase === "string"
            ? params.task.metadataJson.candidateResolutionPhase
            : undefined,
        candidateResolutionEvidenceChunkIds: stringSet(objectRecord(params.task.metadataJson)?.candidateResolutionEvidenceChunkIds),
        compilerTaskSummary: compilerSummary ?? compilerTaskSummary?.summary,
        compilerTaskSummaryConfidence: compilerSummaryConfidence ?? compilerTaskSummary?.confidence,
        project: typeof fallback.metadataJson.project === "string" ? fallback.metadataJson.project : undefined,
        currentTask: typeof fallback.metadataJson.currentTask === "string"
            ? fallback.metadataJson.currentTask
            : undefined,
        nextAction: typeof fallback.metadataJson.nextAction === "string"
            ? fallback.metadataJson.nextAction
            : undefined,
        blocker: typeof fallback.metadataJson.blocker === "string" ? fallback.metadataJson.blocker : undefined,
        lastEmittedOutcomeKey: typeof params.task.metadataJson?.lastEmittedOutcomeKey === "string"
            ? params.task.metadataJson.lastEmittedOutcomeKey
            : undefined,
    });
    return {
        title: fallback.title,
        summary: compilerSummary ?? fallback.summary,
        metadataJson: {
            ...fallback.metadataJson,
            ...taskSummaryMetadataFields({
                summarySource,
                summaryQuality: "working",
                summaryBasisFingerprint,
                observedAt: params.observedAt,
                ...(compilerTaskSummary?.summary
                    ? {
                        compilerTaskSummary: compilerTaskSummary.summary,
                        compilerTaskSummaryConfidence: compilerTaskSummary.confidence,
                    }
                    : {}),
            }),
        },
        summarySource,
        summaryQuality: "working",
        summaryBasisFingerprint,
        ...(compilerTaskSummary?.summary ? { compilerTaskSummary: compilerTaskSummary.summary } : {}),
        ...(typeof compilerTaskSummary?.confidence === "number"
            ? { compilerTaskSummaryConfidence: compilerTaskSummary.confidence }
            : {}),
    };
}
export function taskSummaryNeedsUpgrade(params) {
    if (params.evidence.chunks.length === 0) {
        return false;
    }
    const metadata = objectRecord(params.task.metadataJson);
    const source = taskSummarySource(metadata);
    const quality = taskSummaryQuality(metadata);
    const currentFingerprint = metadataString(metadata?.summaryBasisFingerprint);
    const summaryUpdatedAt = metadataString(metadata?.summaryUpdatedAt) ?? params.task.updatedAt;
    const currentMs = Date.parse(params.now);
    const updatedMs = Date.parse(summaryUpdatedAt);
    const hoursSinceSummaryUpdate = Number.isFinite(currentMs) && Number.isFinite(updatedMs)
        ? Math.max(0, (currentMs - updatedMs) / (60 * 60 * 1000))
        : 0;
    const hasChangedEvidence = currentFingerprint !== params.evidence.fingerprint;
    const highValueEvidence = Boolean(params.evidence.candidateResolution) ||
        params.evidence.candidateResolutionEvidenceChunkIds.length > 0 ||
        Boolean(params.evidence.lastEmittedOutcomeKey) ||
        params.evidence.linkedEvents.length > 0 ||
        params.evidence.chunks.some((chunk) => chunk.role === "tool") ||
        params.evidence.chunks.length >= 5;
    if (!highValueEvidence) {
        return false;
    }
    if (source === "heuristic_fallback" || !source) {
        return true;
    }
    if (quality !== "stable") {
        return true;
    }
    if (hasChangedEvidence && hoursSinceSummaryUpdate >= 1) {
        return true;
    }
    if (hoursSinceSummaryUpdate >= 24 && params.evidence.linkedEvents.length > 0) {
        return true;
    }
    return false;
}
export function taskSummaryUpgradePriority(params) {
    const metadata = objectRecord(params.task.metadataJson);
    const source = taskSummarySource(metadata);
    const toolCount = params.evidence.chunks.filter((chunk) => chunk.role === "tool").length;
    return ((source === "heuristic_fallback" || !source ? 3 : 0) +
        (params.evidence.candidateResolution ? 3 : 0) +
        (params.evidence.lastEmittedOutcomeKey ? 2 : 0) +
        (params.evidence.linkedEvents.length > 0 ? 2 : 0) +
        (params.evidence.compilerTaskSummary ? 1.5 : 0) +
        (toolCount > 0 ? 1.5 : 0) +
        Math.min(params.evidence.chunks.length, 8) * 0.08);
}
