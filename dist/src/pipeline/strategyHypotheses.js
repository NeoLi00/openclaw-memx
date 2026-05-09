import { clamp01, cosineSimilarity, normalizeText, stableHash, truncateText } from "../support.js";
import { buildEntityMention, resolveEntityMention } from "./entityResolver.js";
import { buildMaintenanceContractMetadata, uniqueMaintenanceRefs } from "./maintenanceContract.js";
import { tokenizeSearchTerms } from "./semantic/heuristics.js";
import { semanticTextSimilarity } from "./semantic/textSimilarity.js";
const STRATEGY_EMBEDDING_BUDGET = 12;
const STRATEGY_STOPWORDS = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "when",
    "then",
    "task",
    "issue",
    "problem",
    "route",
    "routing",
    "work",
    "using",
    "still",
    "need",
    "needs",
    "confirmation",
    "验证",
    "处理",
    "问题",
    "任务",
    "需要",
    "确认",
    "继续",
    "当前",
]);
function average(values) {
    if (values.length === 0) {
        return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function truthyString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function phaseWeight(phase) {
    switch (phase) {
        case "resolved":
            return 1;
        case "validated":
            return 0.92;
        case "attempting":
            return 0.4;
        default:
            return 0.55;
    }
}
function shouldConsiderTaskBelief(belief, task) {
    const metadata = task.metadataJson ?? {};
    const hasOutcome = Boolean(truthyString(metadata.lastEmittedOutcomeKey) ||
        truthyString(metadata.lastPromotedOutcomeHypothesisId));
    const promotionAvg = typeof belief.metadataJson.promotionAvg === "number" ? belief.metadataJson.promotionAvg : 0;
    return (belief.memoryKind === "task" &&
        Boolean(belief.contentRef) &&
        belief.stage !== "quarantined" &&
        belief.stage !== "superseded" &&
        (belief.posteriorConfidence >= 0.66 ||
            belief.outcomeSupportScore >= 0.68 ||
            promotionAvg >= 0.72) &&
        belief.outcomeSupportScore >= 0.5 &&
        belief.contradictionScore < 0.45 &&
        hasOutcome);
}
function resolveStrategyDomainEntityId(store, ctx, task) {
    const metadata = task.metadataJson ?? {};
    const parts = [
        truthyString(metadata.project),
        truthyString(metadata.currentTask),
        truthyString(task.title),
    ].filter((value) => Boolean(value));
    for (const part of parts) {
        const result = resolveEntityMention(store, ctx, buildEntityMention({
            ctx,
            scope: task.scope,
            rawText: part,
            proposedType: "project",
            semanticRole: "project",
            sourceRef: `task:${task.taskId}`,
            supportText: `${task.title}\n${JSON.stringify(task.metadataJson ?? {})}`,
            observedAt: task.updatedAt,
            sessionKey: task.sessionKey,
            metadataJson: {
                generatedFrom: "strategy-domain-resolution",
            },
        }), { createIfMissing: false, persist: false });
        if (result.method !== "uncertain") {
            return result.entity.entityId;
        }
    }
    const semanticEntity = task.metadataJson?.canonicalEntityId;
    return typeof semanticEntity === "string" && semanticEntity.trim()
        ? semanticEntity.trim()
        : undefined;
}
function buildTaskStrategyCandidate(store, ctx, belief) {
    const task = belief.contentRef ? store.taskRepo.get(belief.contentRef) : null;
    if (!task || !shouldConsiderTaskBelief(belief, task)) {
        return null;
    }
    const metadata = task.metadataJson ?? {};
    const resolutionText = truthyString(metadata.candidateResolution);
    if (!resolutionText) {
        return null;
    }
    const domainText = [
        truthyString(task.title),
        truthyString(metadata.currentTask),
        truthyString(metadata.project),
    ]
        .filter(Boolean)
        .join(" ")
        .trim();
    const chunks = store.chunkRepo.listByTask(task.taskId);
    return {
        task,
        belief,
        resolutionText,
        domainText: domainText || task.title,
        canonicalText: [domainText || task.title, resolutionText].join(" ").trim(),
        canonicalEntityId: resolveStrategyDomainEntityId(store, ctx, task),
        hasToolEvidence: chunks.some((chunk) => chunk.role === "tool"),
        hasAssistantEvidence: chunks.some((chunk) => chunk.role === "assistant"),
        outcomeKey: truthyString(metadata.lastEmittedOutcomeKey),
        phase: truthyString(metadata.candidateResolutionPhase) ?? truthyString(metadata.taskPhase),
    };
}
function structuredDomainParts(candidate) {
    const metadata = candidate.task.metadataJson ?? {};
    return [
        truthyString(metadata.project),
        truthyString(metadata.currentTask),
        truthyString(candidate.task.title),
    ].filter((value) => Boolean(value));
}
function structuredBucketKey(candidate) {
    if (candidate.canonicalEntityId) {
        return `${candidate.task.scope}:entity:${candidate.canonicalEntityId}`;
    }
    const primary = structuredDomainParts(candidate)[0] ??
        truthyString(candidate.task.metadataJson?.currentTask) ??
        truthyString(candidate.task.metadataJson?.project) ??
        truthyString(candidate.task.metadataJson?.candidateResolution) ??
        candidate.outcomeKey ??
        candidate.task.taskId;
    return `${candidate.task.scope}:${normalizeText(primary)}`;
}
function embeddingSimilarity(left, right, embeddingByTaskId) {
    const leftEmbedding = embeddingByTaskId?.get(left.task.taskId);
    const rightEmbedding = embeddingByTaskId?.get(right.task.taskId);
    if (!leftEmbedding ||
        !rightEmbedding ||
        leftEmbedding.length === 0 ||
        rightEmbedding.length === 0) {
        return null;
    }
    return clamp01(cosineSimilarity(leftEmbedding, rightEmbedding));
}
function candidateSimilarity(left, right, embeddingByTaskId) {
    const combined = semanticTextSimilarity(left.canonicalText, right.canonicalText);
    const domain = semanticTextSimilarity(left.domainText, right.domainText);
    const resolution = semanticTextSimilarity(left.resolutionText, right.resolutionText);
    const lexicalSimilarity = Math.max(combined, domain * 0.45 + resolution * 0.55);
    const embeddingScore = embeddingSimilarity(left, right, embeddingByTaskId);
    if (embeddingScore === null) {
        return lexicalSimilarity;
    }
    return clamp01(embeddingScore * 0.85 + lexicalSimilarity * 0.15);
}
function clusterCandidates(candidates, embeddingByTaskId) {
    const remaining = [...candidates].sort((left, right) => {
        if (structuredBucketKey(left) !== structuredBucketKey(right)) {
            return structuredBucketKey(left).localeCompare(structuredBucketKey(right));
        }
        return right.belief.posteriorConfidence - left.belief.posteriorConfidence;
    });
    const clusters = [];
    while (remaining.length > 0) {
        const anchor = remaining.shift();
        const cluster = [anchor];
        const leftovers = [];
        for (const candidate of remaining) {
            if (structuredBucketKey(anchor) !== structuredBucketKey(candidate)) {
                leftovers.push(candidate);
                continue;
            }
            const similarity = candidateSimilarity(anchor, candidate, embeddingByTaskId);
            const domain = semanticTextSimilarity(anchor.domainText, candidate.domainText);
            const resolution = semanticTextSimilarity(anchor.resolutionText, candidate.resolutionText);
            const embeddingScore = embeddingSimilarity(anchor, candidate, embeddingByTaskId);
            const sameStructuredResolution = normalizeText(anchor.resolutionText) === normalizeText(candidate.resolutionText);
            const matches = embeddingScore !== null
                ? sameStructuredResolution ||
                    embeddingScore >= 0.78 ||
                    (embeddingScore >= 0.72 && resolution >= 0.58)
                : similarity >= 0.74 || (domain >= 0.56 && resolution >= 0.62);
            if (matches) {
                cluster.push(candidate);
            }
            else {
                leftovers.push(candidate);
            }
        }
        remaining.splice(0, remaining.length, ...leftovers);
        clusters.push(cluster);
    }
    return clusters;
}
function selectDomainLabel(cluster) {
    const structuredCounts = new Map();
    for (const candidate of cluster) {
        for (const part of structuredDomainParts(candidate)) {
            structuredCounts.set(part, (structuredCounts.get(part) ?? 0) + 1);
        }
    }
    const structuredLabel = [...structuredCounts.entries()]
        .sort((left, right) => {
        if (right[1] !== left[1]) {
            return right[1] - left[1];
        }
        if (right[0].length !== left[0].length) {
            return right[0].length - left[0].length;
        }
        return left[0].localeCompare(right[0]);
    })
        .map(([label]) => label)
        .find(Boolean);
    if (structuredLabel) {
        return truncateText(structuredLabel, 48);
    }
    const counts = new Map();
    const threshold = Math.max(2, Math.ceil(cluster.length / 2));
    for (const candidate of cluster) {
        const terms = tokenizeSearchTerms(`${candidate.domainText} ${candidate.resolutionText}`, STRATEGY_STOPWORDS);
        for (const term of new Set(terms)) {
            counts.set(term, (counts.get(term) ?? 0) + 1);
        }
    }
    const tokens = [...counts.entries()]
        .filter(([, count]) => count >= threshold)
        .sort((left, right) => {
        if (right[1] !== left[1]) {
            return right[1] - left[1];
        }
        if (right[0].length !== left[0].length) {
            return right[0].length - left[0].length;
        }
        return left[0].localeCompare(right[0]);
    })
        .map(([token]) => token)
        .slice(0, 4);
    if (tokens.length > 0) {
        return tokens.join(" ");
    }
    return truncateText(cluster[0]?.task.title || "similar tasks", 48);
}
function selectStrategyAnchorCandidate(cluster) {
    return [...cluster].sort((left, right) => {
        if (right.belief.posteriorConfidence !== left.belief.posteriorConfidence) {
            return right.belief.posteriorConfidence - left.belief.posteriorConfidence;
        }
        if (right.belief.outcomeSupportScore !== left.belief.outcomeSupportScore) {
            return right.belief.outcomeSupportScore - left.belief.outcomeSupportScore;
        }
        return left.task.taskId.localeCompare(right.task.taskId);
    })[0];
}
function stableStrategyKeyPart(text, fallback, maxTerms) {
    const tokens = tokenizeSearchTerms(text, STRATEGY_STOPWORDS).slice(0, maxTerms);
    if (tokens.length > 0) {
        return tokens.join(".");
    }
    return (normalizeText(fallback)
        .replace(/[^\p{L}\p{N}]+/gu, ".")
        .replace(/^\.+|\.+$/g, "") || "");
}
function stableStrategyDomainKey(cluster, domainLabel) {
    const anchor = selectStrategyAnchorCandidate(cluster);
    const domainSource = structuredDomainParts(anchor).join(" ").trim() || anchor.domainText;
    const domainPart = stableStrategyKeyPart(domainSource, domainLabel, 3);
    const resolutionPart = stableHash([normalizeText(anchor.resolutionText)]).slice(0, 8);
    const stableKey = [domainPart, resolutionPart].filter(Boolean).join(".");
    if (anchor.canonicalEntityId) {
        return `entity:${anchor.canonicalEntityId}:${stableKey || resolutionPart}`;
    }
    if (stableKey) {
        return stableKey;
    }
    return stableHash([
        normalizeText(anchor.domainText),
        normalizeText(anchor.resolutionText),
        anchor.task.scope,
    ]).slice(0, 16);
}
function buildStrategySummary(cluster, domainLabel) {
    const exemplar = [...cluster].sort((left, right) => {
        if (right.belief.outcomeSupportScore !== left.belief.outcomeSupportScore) {
            return right.belief.outcomeSupportScore - left.belief.outcomeSupportScore;
        }
        return right.belief.posteriorConfidence - left.belief.posteriorConfidence;
    })[0];
    const resolution = exemplar.resolutionText.replace(/[。.!！?？]+$/u, "").trim();
    const toolGroundedRatio = cluster.filter((candidate) => candidate.hasToolEvidence).length / Math.max(cluster.length, 1);
    const validationSuffix = toolGroundedRatio >= 0.5
        ? " Validate the result with tool or test feedback before treating it as resolved."
        : "";
    return truncateText(`When handling ${domainLabel || "similar tasks"}, prefer: ${resolution}.${validationSuffix}`, 240);
}
function stringArray(value) {
    return Array.isArray(value)
        ? value.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
        : [];
}
function semanticSourceFromMetadata(metadata) {
    const source = metadata.semanticSource;
    return source === "upstream_structured" ||
        source === "embedding_clustered" ||
        source === "llm_upgrade" ||
        source === "deterministic_lifecycle" ||
        source === "lexical_fallback"
        ? source
        : "upstream_structured";
}
function semanticSourcesFromMetadata(metadata) {
    return stringArray(metadata.semanticSources).filter((source) => source === "upstream_structured" ||
        source === "embedding_clustered" ||
        source === "llm_upgrade" ||
        source === "deterministic_lifecycle" ||
        source === "lexical_fallback");
}
function strategyMaintenanceMetadata(params) {
    const supportContentRefs = uniqueMaintenanceRefs(params.pattern.supportTaskIds.map((taskId) => `task:${taskId}`));
    const supportBeliefIds = uniqueMaintenanceRefs(params.pattern.supportBeliefIds);
    const canonicalEntityIds = stringArray(params.pattern.metadataJson.canonicalEntityIds);
    const sourceRef = supportContentRefs[0] ?? supportBeliefIds[0];
    return buildMaintenanceContractMetadata({
        existing: {
            ...params.pattern.metadataJson,
            ...(canonicalEntityIds.length > 0 ? { domainEntityId: canonicalEntityIds[0] } : {}),
        },
        sourceRef,
        supportContentRefs,
        supportBeliefIds,
        derivedFromIds: uniqueMaintenanceRefs([...supportBeliefIds, ...supportContentRefs]),
        semanticSource: semanticSourceFromMetadata(params.pattern.metadataJson),
        semanticSources: semanticSourcesFromMetadata(params.pattern.metadataJson),
        authoritySource: params.authoritySource,
        generatedFrom: "successful_task_outcomes",
        recallLayer: "strategy",
        answerEligibleByDefault: false,
        materializedEpoch: params.materializedEpoch,
        derivationPolicyVersion: "memx-authority-v3",
    });
}
export function inferStrategyHypothesisStage(params) {
    if (params.contradictionScore >= 0.52) {
        return "quarantined";
    }
    const roles = new Set(params.groundedByRoles ?? []);
    const resolvedPhase = params.taskPhase === "resolved" || params.taskPhase === "validated";
    const hasGroundedWorkflowEvidence = params.explicitInstruction === true ||
        params.groundedResolution === true ||
        (resolvedPhase && roles.has("user") && (roles.has("tool") || roles.has("assistant")));
    if (params.confidence >= 0.78 &&
        params.usefulnessScore >= 0.62 &&
        params.stabilityScore >= 0.62) {
        return "active";
    }
    if (hasGroundedWorkflowEvidence &&
        params.contradictionScore <= 0.24 &&
        params.confidence >= 0.64 &&
        params.usefulnessScore >= 0.56 &&
        params.stabilityScore >= 0.56) {
        return "active";
    }
    return "candidate";
}
export async function deriveStrategyHypotheses(store, ctx) {
    const workflowPatternResult = await deriveWorkflowPatternSummariesDetailed(store, ctx);
    const workflowPatterns = workflowPatternResult.summaries;
    const stats = {
        strategiesUpserted: 0,
        activeStrategies: 0,
        candidateStrategies: 0,
        quarantinedStrategies: 0,
        embeddingBudget: workflowPatternResult.embeddingBudget,
        embeddingCandidatesConsidered: workflowPatternResult.embeddingCandidatesConsidered,
        embeddingCandidatesEmbedded: workflowPatternResult.embeddingCandidatesEmbedded,
        authoritySource: workflowPatternResult.authoritySource,
        semanticSources: workflowPatternResult.semanticSources,
    };
    for (const pattern of workflowPatterns) {
        const sourceEpoch = ctx.readEpoch ?? store.client.currentMemoryEpoch(ctx.agentId);
        const materializedEpoch = store.client.nextMemoryEpoch(ctx.agentId, ctx.now);
        const stage = inferStrategyHypothesisStage({
            confidence: pattern.confidence,
            usefulnessScore: pattern.usefulnessScore,
            stabilityScore: pattern.stabilityScore,
            contradictionScore: pattern.contradictionScore,
        });
        const strategyId = stableHash([ctx.agentId, pattern.scope, pattern.domainKey]);
        const supportBeliefIds = uniqueMaintenanceRefs(pattern.supportBeliefIds);
        const supportTaskIds = uniqueMaintenanceRefs(pattern.supportTaskIds);
        store.strategyRepo.upsert({
            strategyId,
            agentId: ctx.agentId,
            scope: pattern.scope,
            domainKey: pattern.domainKey,
            summary: pattern.summary,
            supportBeliefIds,
            supportTaskIds,
            confidence: pattern.confidence,
            usefulnessScore: pattern.usefulnessScore,
            stabilityScore: pattern.stabilityScore,
            contradictionScore: pattern.contradictionScore,
            stage,
            derivedFromMinEpoch: sourceEpoch,
            derivedFromMaxEpoch: sourceEpoch,
            materializedEpoch,
            derivedFromKind: "workflow_pattern_cluster",
            derivedFromIds: uniqueMaintenanceRefs([...supportBeliefIds, ...supportTaskIds]),
            derivedAtEpoch: sourceEpoch,
            derivationPolicyVersion: "memx-authority-v3",
            metadataJson: strategyMaintenanceMetadata({
                pattern: {
                    ...pattern,
                    supportBeliefIds,
                    supportTaskIds,
                },
                authoritySource: workflowPatternResult.authoritySource,
                materializedEpoch,
            }),
            createdAt: ctx.now,
            updatedAt: ctx.now,
        });
        stats.strategiesUpserted += 1;
        if (stage === "active") {
            stats.activeStrategies += 1;
        }
        else if (stage === "quarantined") {
            stats.quarantinedStrategies += 1;
        }
        else {
            stats.candidateStrategies += 1;
        }
    }
    return stats;
}
async function deriveWorkflowPatternSummariesDetailed(store, ctx) {
    const taskBeliefs = store.beliefRepo
        .listByAgent({ agentId: ctx.agentId })
        .filter((belief) => belief.memoryKind === "task");
    const candidates = taskBeliefs
        .map((belief) => buildTaskStrategyCandidate(store, ctx, belief))
        .filter((candidate) => Boolean(candidate))
        .filter((candidate) => ctx.scopes.includes(candidate.task.scope));
    const sortedForEmbedding = [...candidates].sort((left, right) => {
        if (right.belief.posteriorConfidence !== left.belief.posteriorConfidence) {
            return right.belief.posteriorConfidence - left.belief.posteriorConfidence;
        }
        if (right.belief.usefulnessScore !== left.belief.usefulnessScore) {
            return right.belief.usefulnessScore - left.belief.usefulnessScore;
        }
        return right.belief.stabilityScore - left.belief.stabilityScore;
    });
    const embeddingCandidates = sortedForEmbedding.slice(0, STRATEGY_EMBEDDING_BUDGET);
    const embeddingByTaskId = ctx.config.advanced.enableEmbeddingClustering && embeddingCandidates.length > 1
        ? new Map(embeddingCandidates.map((candidate) => [candidate.task.taskId, []]))
        : undefined;
    if (embeddingByTaskId) {
        const embeddings = await store.retrievalBackend.embedTextsBatch(embeddingCandidates.map((candidate) => candidate.canonicalText), "passage");
        embeddingCandidates.forEach((candidate, index) => {
            embeddingByTaskId.set(candidate.task.taskId, embeddings[index] ?? []);
        });
    }
    const rawClusters = clusterCandidates(candidates, embeddingByTaskId).filter((cluster) => new Set(cluster.map((candidate) => candidate.task.taskId)).size >= 2);
    const clusters = rawClusters;
    const summaries = [];
    const semanticSources = new Set(["upstream_structured"]);
    for (const cluster of clusters) {
        const domainLabel = selectDomainLabel(cluster);
        const domainKey = stableStrategyDomainKey(cluster, domainLabel);
        const cohesion = average(cluster.map((candidate) => candidateSimilarity(cluster[0], candidate, embeddingByTaskId)));
        const repeatedSupport = clamp01(cluster.length / 3);
        const avgPosterior = average(cluster.map((candidate) => candidate.belief.posteriorConfidence));
        const avgUsefulness = average(cluster.map((candidate) => candidate.belief.usefulnessScore));
        const avgStability = average(cluster.map((candidate) => candidate.belief.stabilityScore));
        const avgContradiction = average(cluster.map((candidate) => candidate.belief.contradictionScore));
        const avgOutcomeSupport = average(cluster.map((candidate) => candidate.belief.outcomeSupportScore));
        const sessionDiversity = clamp01(new Set(cluster.map((candidate) => candidate.task.sessionKey)).size / 2);
        const toolGroundedRatio = cluster.filter((candidate) => candidate.hasToolEvidence).length / Math.max(cluster.length, 1);
        const phaseScore = average(cluster.map((candidate) => phaseWeight(candidate.phase)));
        const confidence = clamp01(avgPosterior * 0.38 +
            avgOutcomeSupport * 0.22 +
            cohesion * 0.18 +
            repeatedSupport * 0.12 +
            phaseScore * 0.1 -
            avgContradiction * 0.25);
        const usefulnessScore = clamp01(avgUsefulness * 0.2 +
            repeatedSupport * 0.4 +
            sessionDiversity * 0.25 +
            avgOutcomeSupport * 0.15);
        const stabilityScore = clamp01(avgStability * 0.46 +
            cohesion * 0.24 +
            repeatedSupport * 0.14 +
            toolGroundedRatio * 0.08 +
            phaseScore * 0.08);
        const contradictionScore = clamp01(avgContradiction);
        const anchor = cluster[0];
        const clusterUsesEmbedding = cluster.some((candidate) => (embeddingByTaskId?.get(candidate.task.taskId)?.length ?? 0) > 0);
        const clusterSemanticSource = clusterUsesEmbedding
            ? "embedding_clustered"
            : "lexical_fallback";
        semanticSources.add(clusterSemanticSource);
        summaries.push({
            scope: anchor.task.scope,
            domainKey,
            summary: buildStrategySummary(cluster, domainLabel),
            supportBeliefIds: cluster.map((candidate) => candidate.belief.beliefId),
            supportTaskIds: cluster.map((candidate) => candidate.task.taskId),
            confidence,
            usefulnessScore,
            stabilityScore,
            contradictionScore,
            metadataJson: {
                clusterSize: cluster.length,
                domainLabel,
                cohesion,
                repeatedSupport,
                sessionDiversity,
                toolGroundedRatio,
                phaseScore,
                supportOutcomeKeys: cluster.map((candidate) => candidate.outcomeKey).filter(Boolean),
                canonicalEntityIds: [
                    ...new Set(cluster.map((candidate) => candidate.canonicalEntityId).filter(Boolean)),
                ],
                hasAssistantGrounding: cluster.some((candidate) => candidate.hasAssistantEvidence),
                generatedFrom: "successful_task_outcomes",
                semanticSource: clusterSemanticSource,
                semanticSources: ["upstream_structured", clusterSemanticSource],
            },
        });
    }
    return {
        summaries,
        embeddingBudget: STRATEGY_EMBEDDING_BUDGET,
        embeddingCandidatesConsidered: candidates.length,
        embeddingCandidatesEmbedded: embeddingByTaskId ? embeddingCandidates.length : 0,
        authoritySource: embeddingByTaskId ? "embedding_clustered" : "deterministic_aggregated",
        semanticSources: [...semanticSources],
    };
}
export async function deriveWorkflowPatternSummaries(store, ctx) {
    const result = await deriveWorkflowPatternSummariesDetailed(store, ctx);
    return result.summaries;
}
