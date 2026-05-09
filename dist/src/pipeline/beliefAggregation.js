import { clamp01, nowIso, normalizeText, stableHash } from "../support.js";
import { FALLBACK_PRIOR_CONFIDENCE, FALLBACK_SOURCE_RELIABILITY, POSTERIOR_CONSISTENCY_WEIGHT, POSTERIOR_CONTRADICTION_WEIGHT, POSTERIOR_CORRECTION_WEIGHT, POSTERIOR_DEMOTION_WEIGHT, POSTERIOR_MIDPOINT, POSTERIOR_OUTCOME_WEIGHT, POSTERIOR_PROMOTION_WEIGHT, POSTERIOR_REPEATED_USE_WEIGHT, POSTERIOR_STABILITY_WEIGHT, POSTERIOR_STALE_DECAY_WEIGHT, POSTERIOR_TEMPORAL_WEIGHT, POSTERIOR_USEFULNESS_WEIGHT, SOURCE_RELIABILITY, } from "./constants.js";
import { buildEntityMention, resolveEntityMention } from "./entityResolver.js";
function average(values) {
    if (values.length === 0) {
        return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function maxIso(values) {
    const filtered = values.filter((value) => Boolean(value));
    if (filtered.length === 0) {
        return undefined;
    }
    return filtered.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest);
}
function minIso(values) {
    const filtered = values.filter((value) => Boolean(value));
    if (filtered.length === 0) {
        return undefined;
    }
    return filtered.reduce((earliest, value) => Date.parse(value) < Date.parse(earliest) ? value : earliest);
}
function addDays(iso, days) {
    const date = new Date(iso);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString();
}
function daysBetween(earlierIso, laterIso) {
    const deltaMs = Date.parse(laterIso) - Date.parse(earlierIso);
    return Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs / 86_400_000 : 0;
}
function sourceReliabilityFromMarker(marker) {
    switch (marker) {
        case "tool":
            return SOURCE_RELIABILITY.tool;
        case "user":
            return SOURCE_RELIABILITY.user;
        case "assistant":
            return SOURCE_RELIABILITY.assistant;
        case "synthesized":
            return SOURCE_RELIABILITY.synthesized;
        default:
            return SOURCE_RELIABILITY.default;
    }
}
function fallbackPriorConfidence(memoryKind) {
    return FALLBACK_PRIOR_CONFIDENCE[memoryKind];
}
function fallbackSourceReliability(memoryKind) {
    return (FALLBACK_SOURCE_RELIABILITY[memoryKind] ??
        FALLBACK_SOURCE_RELIABILITY.default);
}
function stagePolicy(memoryKind) {
    switch (memoryKind) {
        case "state":
            return {
                probationaryPosterior: 0.54,
                activePosterior: 0.72,
                quarantineContradiction: 0.78,
                supersessionGap: 0.12,
                decayAfterDays: 14,
                minSupportForProbationary: 0.34,
                minSupportForActive: 0.52,
            };
        case "task":
            return {
                probationaryPosterior: 0.58,
                activePosterior: 0.72,
                quarantineContradiction: 0.8,
                supersessionGap: 0.14,
                decayAfterDays: 21,
                minSupportForProbationary: 0.32,
                minSupportForActive: 0.46,
            };
        case "fact":
            return {
                probationaryPosterior: 0.66,
                activePosterior: 0.82,
                quarantineContradiction: 0.72,
                supersessionGap: 0.14,
                decayAfterDays: 90,
                minSupportForProbationary: 0.38,
                minSupportForActive: 0.38,
            };
        case "event":
            return {
                probationaryPosterior: 0.54,
                activePosterior: 0.7,
                quarantineContradiction: 0.84,
                supersessionGap: 0.16,
                decayAfterDays: 45,
                minSupportForProbationary: 0.32,
                minSupportForActive: 0.48,
            };
        case "graph_edge":
            return {
                probationaryPosterior: 0.6,
                activePosterior: 0.76,
                quarantineContradiction: 0.76,
                supersessionGap: 0.14,
                decayAfterDays: 120,
                minSupportForProbationary: 0.36,
                minSupportForActive: 0.52,
            };
        case "chunk":
            return {
                probationaryPosterior: 0.48,
                activePosterior: 0.7,
                quarantineContradiction: 0.88,
                supersessionGap: 0.18,
                decayAfterDays: 10,
                minSupportForProbationary: 0.3,
                minSupportForActive: 0.5,
            };
        case "strategy":
            return {
                probationaryPosterior: 0.7,
                activePosterior: 0.86,
                quarantineContradiction: 0.68,
                supersessionGap: 0.12,
                decayAfterDays: 180,
                minSupportForProbationary: 0.45,
                minSupportForActive: 0.64,
            };
    }
}
function loadContentSnapshot(store, agentId, memoryKind, contentRef) {
    if (!contentRef) {
        return null;
    }
    switch (memoryKind) {
        case "state": {
            const row = store.client
                .prepare(`SELECT scope, confidence, source_ref AS sourceRef, updated_at AS updatedAt
             FROM state_kv
            WHERE agent_id = ?
              AND scope || ':' || key = ?
            LIMIT 1`)
                .get(agentId, contentRef);
            if (!row) {
                return null;
            }
            return {
                scope: row.scope,
                priorConfidence: clamp01(row.confidence),
                sourceReliability: sourceReliabilityFromMarker(row.sourceRef.split(":")[0]),
                firstSeenAt: row.updatedAt,
                lastSeenAt: row.updatedAt,
            };
        }
        case "task": {
            const row = store.client
                .prepare(`SELECT scope, started_at AS startedAt, updated_at AS updatedAt, status
             FROM conversation_tasks
            WHERE agent_id = ?
              AND task_id = ?
            LIMIT 1`)
                .get(agentId, contentRef);
            if (!row) {
                return null;
            }
            const priorConfidence = row.status === "active" ? 0.72 : 0.64;
            return {
                scope: row.scope,
                priorConfidence,
                sourceReliability: 0.72,
                firstSeenAt: row.startedAt,
                lastSeenAt: row.updatedAt,
            };
        }
        case "fact": {
            const row = store.client
                .prepare(`SELECT scope, confidence, created_at AS createdAt, updated_at AS updatedAt
             FROM facts
            WHERE agent_id = ?
              AND fact_id = ?
            LIMIT 1`)
                .get(agentId, contentRef);
            if (!row) {
                return null;
            }
            return {
                scope: row.scope,
                priorConfidence: clamp01(row.confidence),
                sourceReliability: 0.78,
                firstSeenAt: row.createdAt,
                lastSeenAt: row.updatedAt,
            };
        }
        case "event": {
            const row = store.client
                .prepare(`SELECT scope, confidence, observed_at AS observedAt, source_kind AS sourceKind
             FROM episodic_events
            WHERE agent_id = ?
              AND event_id = ?
            LIMIT 1`)
                .get(agentId, contentRef);
            if (!row) {
                return null;
            }
            return {
                scope: row.scope,
                priorConfidence: clamp01(row.confidence),
                sourceReliability: sourceReliabilityFromMarker(row.sourceKind),
                firstSeenAt: row.observedAt,
                lastSeenAt: row.observedAt,
            };
        }
        case "graph_edge": {
            const row = store.client
                .prepare(`SELECT scope, confidence, evidence_ref AS evidenceRef, created_at AS createdAt, updated_at AS updatedAt
             FROM graph_edges
            WHERE agent_id = ?
              AND edge_id = ?
            LIMIT 1`)
                .get(agentId, contentRef);
            if (!row) {
                return null;
            }
            return {
                scope: row.scope,
                priorConfidence: clamp01(row.confidence),
                sourceReliability: sourceReliabilityFromMarker(row.evidenceRef.split(":")[0]),
                firstSeenAt: row.createdAt,
                lastSeenAt: row.updatedAt,
            };
        }
        case "chunk": {
            const row = store.client
                .prepare(`SELECT scope, role, created_at AS createdAt, updated_at AS updatedAt
             FROM conversation_chunks
            WHERE agent_id = ?
              AND chunk_id = ?
            LIMIT 1`)
                .get(agentId, contentRef);
            if (!row) {
                return null;
            }
            return {
                scope: row.scope,
                priorConfidence: 0.44,
                sourceReliability: sourceReliabilityFromMarker(row.role),
                firstSeenAt: row.createdAt,
                lastSeenAt: row.updatedAt,
            };
        }
        case "strategy":
            return null;
    }
}
function summarizeSignals(signals) {
    const byType = new Map();
    for (const signal of signals) {
        const bucket = byType.get(signal.signalType) ?? [];
        bucket.push(signal);
        byType.set(signal.signalType, bucket);
    }
    const counts = Object.fromEntries([...byType.entries()].map(([signalType, bucket]) => [signalType, bucket.length]));
    const usageSignals = [
        ...(byType.get("future_usefulness") ?? []),
        ...(byType.get("retrieval_support") ?? []),
        ...(byType.get("repeated_use") ?? []),
    ];
    return {
        retrievalSupportAvg: average((byType.get("retrieval_support") ?? []).map((signal) => signal.value)),
        futureUsefulnessAvg: average((byType.get("future_usefulness") ?? []).map((signal) => signal.value)),
        outcomeFeedbackAvg: average((byType.get("outcome_feedback") ?? []).map((signal) => signal.value)),
        contradictionAvg: average((byType.get("contradiction") ?? []).map((signal) => signal.value)),
        selfConsistencyAvg: average((byType.get("self_consistency") ?? []).map((signal) => signal.value)),
        temporalStabilityAvg: average((byType.get("temporal_stability") ?? []).map((signal) => signal.value)),
        assistantGroundingAvg: average((byType.get("assistant_grounding") ?? []).map((signal) => signal.value)),
        promotionAvg: average((byType.get("promotion") ?? []).map((signal) => signal.value)),
        demotionAvg: average((byType.get("demotion") ?? []).map((signal) => signal.value)),
        correctionAvg: average((byType.get("correction") ?? []).map((signal) => signal.value)),
        repeatedUseAvg: average((byType.get("repeated_use") ?? []).map((signal) => signal.value)),
        staleDecayAvg: average((byType.get("stale_decay") ?? []).map((signal) => signal.value)),
        useCount: (byType.get("future_usefulness") ?? []).length + (byType.get("repeated_use") ?? []).length,
        counts,
        lastUsedAt: maxIso(usageSignals.map((signal) => signal.createdAt)),
    };
}
function metadataNumber(metadata, key, fallback = 0) {
    const value = metadata?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function posteriorConfidence(params) {
    // Dampen contradiction so a single high score cannot overwhelm all positive
    // signals.  sqrt(x) grows more slowly than x, and the cap (0.25) ensures the
    // maximum negative contribution from contradiction alone stays bounded.
    const contradictionPenalty = Math.min(Math.sqrt(params.contradictionScore) * POSTERIOR_CONTRADICTION_WEIGHT, 0.25);
    const demotionPenalty = Math.min(Math.sqrt(params.demotion) * POSTERIOR_DEMOTION_WEIGHT, 0.12);
    const correctionPenalty = Math.min(Math.sqrt(params.correction) * POSTERIOR_CORRECTION_WEIGHT, 0.22);
    const staleDecayPenalty = Math.min(Math.sqrt(params.staleDecay) * POSTERIOR_STALE_DECAY_WEIGHT, 0.1);
    return clamp01(params.priorConfidence +
        (params.usefulnessScore - POSTERIOR_MIDPOINT) * POSTERIOR_USEFULNESS_WEIGHT +
        (params.stabilityScore - POSTERIOR_MIDPOINT) * POSTERIOR_STABILITY_WEIGHT +
        params.outcomeSupportScore * POSTERIOR_OUTCOME_WEIGHT +
        params.selfConsistency * POSTERIOR_CONSISTENCY_WEIGHT +
        params.temporalStability * POSTERIOR_TEMPORAL_WEIGHT +
        params.promotion * POSTERIOR_PROMOTION_WEIGHT -
        correctionPenalty -
        contradictionPenalty -
        demotionPenalty -
        staleDecayPenalty +
        params.repeatedUse * POSTERIOR_REPEATED_USE_WEIGHT);
}
function signalEvidenceSupportScore(summary) {
    return clamp01(summary.retrievalSupportAvg * 0.26 +
        summary.futureUsefulnessAvg * 0.22 +
        summary.outcomeFeedbackAvg * 0.16 +
        summary.assistantGroundingAvg * 0.1 +
        summary.selfConsistencyAvg * 0.1 +
        summary.temporalStabilityAvg * 0.08 +
        summary.repeatedUseAvg * 0.06 +
        summary.promotionAvg * 0.08);
}
function isEntityScopedSemanticKey(semanticKey) {
    return semanticKey.startsWith("entity:");
}
function entityIdFromScopedSemanticKey(semanticKey) {
    const match = semanticKey.match(/^entity:([^:]+):/u);
    return match?.[1];
}
function canonicalTargetContentRef(contentRef, semanticKey) {
    return isEntityScopedSemanticKey(semanticKey) ? undefined : contentRef;
}
function targetGroupKey(params) {
    return `${params.memoryKind}:${canonicalTargetContentRef(params.contentRef, params.semanticKey) ?? params.semanticKey}`;
}
function taskPredicateFromSemanticKey(signal) {
    if (signal.memoryKind === "task" && signal.contentRef) {
        const escapedContentRef = signal.contentRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const taskOutcomeMatch = signal.semanticKey.match(new RegExp(`^task_outcome:${escapedContentRef}:(.+)$`, "u"));
        if (taskOutcomeMatch?.[1]) {
            return `outcome:${normalizeText(taskOutcomeMatch[1])}`;
        }
    }
    return normalizeText(signal.semanticKey).replace(/:/g, ".");
}
export function resolveBeliefTargetKey(store, ctx, scope, signal) {
    const base = {
        memoryKind: signal.memoryKind,
        contentRef: signal.contentRef,
        semanticKey: signal.semanticKey,
        resolutionMethod: "unchanged",
        originalContentRef: signal.contentRef,
        originalSemanticKey: signal.semanticKey,
    };
    if (isEntityScopedSemanticKey(signal.semanticKey)) {
        return {
            ...base,
            contentRef: undefined,
            canonicalEntityId: entityIdFromScopedSemanticKey(signal.semanticKey),
            resolutionMethod: "already_entity_scoped",
        };
    }
    const graphMatch = signal.semanticKey.match(/^graph_edge:([^:]+):([^:]+):(.+)$/u);
    if (graphMatch) {
        const [, srcId, relType, dstId] = graphMatch;
        if (srcId &&
            relType &&
            dstId &&
            store.graphRepo.getEntityById(srcId) &&
            store.graphRepo.getEntityById(dstId)) {
            return {
                ...base,
                contentRef: undefined,
                semanticKey: `entity:${srcId}:graph_edge:${relType}:entity:${dstId}`,
                canonicalEntityId: srcId,
                resolutionMethod: "graph_edge_entity_ids",
            };
        }
    }
    const factMatch = signal.semanticKey.match(/^fact:([^:]+):(.+)$/u);
    if (factMatch) {
        const [, subject, predicate] = factMatch;
        if (subject && predicate) {
            const resolution = resolveEntityMention(store, ctx, buildEntityMention({
                ctx,
                scope,
                rawText: subject,
                semanticRole: "support",
                sourceRef: signal.contentRef ?? signal.signalId,
                supportText: signal.semanticKey,
                observedAt: signal.createdAt,
                metadataJson: {
                    generatedFrom: "belief-semantic-key",
                    predicate,
                },
            }), { createIfMissing: false, persist: false });
            if (resolution.method !== "uncertain") {
                return {
                    ...base,
                    contentRef: undefined,
                    semanticKey: `entity:${resolution.entity.entityId}:fact:${predicate}`,
                    canonicalEntityId: resolution.entity.entityId,
                    resolutionMethod: `entity_resolver:${resolution.method}`,
                };
            }
            return {
                ...base,
                fallbackReason: "fact_subject_unresolved",
                resolutionMethod: "fallback:unresolved_fact_subject",
            };
        }
    }
    const stateMatch = signal.semanticKey.match(/^state:project\.(.+)$/u);
    if (stateMatch?.[1]) {
        const resolution = resolveEntityMention(store, ctx, buildEntityMention({
            ctx,
            scope,
            rawText: stateMatch[1],
            proposedType: "project",
            semanticRole: "project",
            sourceRef: signal.contentRef ?? signal.signalId,
            supportText: signal.semanticKey,
            observedAt: signal.createdAt,
            metadataJson: {
                generatedFrom: "belief-state-key",
            },
        }), { createIfMissing: false, persist: false });
        if (resolution.method !== "uncertain") {
            return {
                ...base,
                contentRef: undefined,
                semanticKey: `entity:${resolution.entity.entityId}:state:project_profile`,
                canonicalEntityId: resolution.entity.entityId,
                resolutionMethod: `entity_resolver:${resolution.method}`,
            };
        }
        return {
            ...base,
            fallbackReason: "state_project_unresolved",
            resolutionMethod: "fallback:unresolved_state_project",
        };
    }
    if (signal.memoryKind === "task" && signal.contentRef) {
        return {
            ...base,
            semanticKey: `task:${signal.contentRef}:${taskPredicateFromSemanticKey(signal)}`,
            resolutionMethod: "fallback:task_content_ref",
            fallbackReason: "task_scoped_target",
        };
    }
    if (signal.sessionKey) {
        return {
            ...base,
            semanticKey: `session:${signal.sessionKey}:${normalizeText(signal.semanticKey).replace(/:/g, ".")}`,
            resolutionMethod: "fallback:session_scoped",
            fallbackReason: "session_scoped_target",
        };
    }
    return {
        ...base,
        semanticKey: `global:${normalizeText(signal.semanticKey).replace(/:/g, ".")}`,
        resolutionMethod: "fallback:global",
        fallbackReason: "global_target",
    };
}
function canonicalizeSignalEntityTarget(store, ctx, scope, signal) {
    const resolved = resolveBeliefTargetKey(store, ctx, scope, signal);
    const targetAudit = {
        originalContentRef: resolved.originalContentRef,
        originalSemanticKey: resolved.originalSemanticKey,
        semanticKey: resolved.semanticKey,
        contentRef: canonicalTargetContentRef(resolved.contentRef, resolved.semanticKey),
        canonicalEntityId: resolved.canonicalEntityId,
        resolutionMethod: resolved.resolutionMethod,
        fallbackReason: resolved.fallbackReason,
    };
    if (resolved.semanticKey === signal.semanticKey &&
        resolved.contentRef === signal.contentRef &&
        resolved.resolutionMethod === "unchanged") {
        return {
            ...signal,
            metadataJson: {
                ...signal.metadataJson,
                beliefTargetResolution: targetAudit,
            },
        };
    }
    return {
        ...signal,
        contentRef: canonicalTargetContentRef(resolved.contentRef, resolved.semanticKey),
        semanticKey: resolved.semanticKey,
        metadataJson: {
            ...signal.metadataJson,
            entityScoped: isEntityScopedSemanticKey(resolved.semanticKey),
            originalContentRef: signal.contentRef,
            originalSemanticKey: signal.semanticKey,
            beliefTargetResolution: targetAudit,
        },
    };
}
function canonicalizeSignalEntityTargets(store, ctx, scope, signals) {
    return signals.map((signal) => canonicalizeSignalEntityTarget(store, ctx, scope, signal));
}
function signalSupportContentRef(signal) {
    if (signal.contentRef) {
        return signal.contentRef;
    }
    const original = signal.metadataJson.originalContentRef;
    return typeof original === "string" && original.trim() ? original.trim() : undefined;
}
function groupSignals(signals) {
    const groups = new Map();
    for (const signal of signals) {
        const contentRef = canonicalTargetContentRef(signal.contentRef, signal.semanticKey);
        const hypothesisKey = targetGroupKey({
            memoryKind: signal.memoryKind,
            contentRef,
            semanticKey: signal.semanticKey,
        });
        const existing = groups.get(hypothesisKey);
        if (existing) {
            existing.signals.push(signal);
            continue;
        }
        groups.set(hypothesisKey, {
            memoryKind: signal.memoryKind,
            contentRef,
            semanticKey: signal.semanticKey,
            signals: [signal],
        });
    }
    return [...groups.values()];
}
function beliefTargetKey(params) {
    return targetGroupKey(params);
}
function beliefFamilyKey(params) {
    return `${params.scope}:${params.memoryKind}:${params.semanticKey}`;
}
function mergeGroupsWithExisting(signals, existingBeliefs) {
    const groups = new Map();
    for (const group of groupSignals(signals)) {
        groups.set(targetGroupKey({
            memoryKind: group.memoryKind,
            contentRef: group.contentRef,
            semanticKey: group.semanticKey,
        }), group);
    }
    for (const belief of existingBeliefs) {
        const key = targetGroupKey({
            memoryKind: belief.memoryKind,
            contentRef: belief.contentRef,
            semanticKey: belief.semanticKey,
        });
        if (groups.has(key)) {
            continue;
        }
        groups.set(key, {
            memoryKind: belief.memoryKind,
            contentRef: canonicalTargetContentRef(belief.contentRef, belief.semanticKey),
            semanticKey: belief.semanticKey,
            signals: [],
        });
    }
    return [...groups.values()];
}
function buildBeliefId(params) {
    return stableHash([
        params.agentId,
        params.scope,
        params.memoryKind,
        params.contentRef ?? "",
        params.semanticKey,
    ]);
}
export function aggregateBeliefs(store, ctx, options = {}) {
    const existingBeliefs = store.beliefRepo.listByAgent({ agentId: ctx.agentId });
    const deltaSignals = options.signalWindow
        ? store.auditRepo.listSignals({
            agentId: ctx.agentId,
            ...(options.signalWindow.sessionKey ? { sessionKey: options.signalWindow.sessionKey } : {}),
            ...(options.signalWindow.after ? { after: options.signalWindow.after } : {}),
            ...(options.signalWindow.until ? { until: options.signalWindow.until } : {}),
        })
        : store.auditRepo.listSignals({ agentId: ctx.agentId });
    const dueBeliefs = existingBeliefs.filter((belief) => (!options.scopes || options.scopes.includes(belief.scope)) &&
        typeof belief.reevaluationDueAt === "string" &&
        belief.reevaluationDueAt <= ctx.now);
    if (deltaSignals.length === 0 && dueBeliefs.length === 0 && existingBeliefs.length === 0) {
        return {
            beliefsUpserted: 0,
            signalsProcessed: 0,
            beliefsNeedingReevaluation: 0,
            beliefsPromoted: 0,
            beliefsDemoted: 0,
            beliefsQuarantined: 0,
            beliefsSuperseded: 0,
            beliefsDecaying: 0,
        };
    }
    const resolverScope = options.scopes?.[0] ?? ctx.scopes[0] ?? `agent:${ctx.agentId}`;
    const canonicalDeltaSignals = canonicalizeSignalEntityTargets(store, ctx, resolverScope, deltaSignals);
    const touchedTargetKeys = new Set();
    const touchedFamilyKeys = new Set();
    const touchedTargets = [];
    for (const signal of canonicalDeltaSignals) {
        const contentRef = canonicalTargetContentRef(signal.contentRef, signal.semanticKey);
        const target = {
            memoryKind: signal.memoryKind,
            contentRef,
            semanticKey: signal.semanticKey,
        };
        const key = beliefTargetKey(target);
        if (!touchedTargetKeys.has(key)) {
            touchedTargetKeys.add(key);
            touchedTargets.push(target);
        }
        touchedFamilyKeys.add(beliefFamilyKey({
            scope: signal.scope,
            memoryKind: signal.memoryKind,
            semanticKey: signal.semanticKey,
        }));
    }
    for (const belief of dueBeliefs) {
        const contentRef = canonicalTargetContentRef(belief.contentRef, belief.semanticKey);
        const target = {
            memoryKind: belief.memoryKind,
            contentRef,
            semanticKey: belief.semanticKey,
        };
        const key = beliefTargetKey(target);
        if (!touchedTargetKeys.has(key)) {
            touchedTargetKeys.add(key);
            touchedTargets.push(target);
        }
        touchedFamilyKeys.add(beliefFamilyKey({
            scope: belief.scope,
            memoryKind: belief.memoryKind,
            semanticKey: belief.semanticKey,
        }));
    }
    const rawSignals = options.signalWindow && touchedTargets.length > 0
        ? store.auditRepo.listSignalsForTargets({
            agentId: ctx.agentId,
            targets: touchedTargets,
            ...(options.signalWindow.until ? { until: options.signalWindow.until } : {}),
        })
        : deltaSignals;
    const signalsById = new Map(canonicalizeSignalEntityTargets(store, ctx, resolverScope, rawSignals).map((signal) => [
        signal.signalId,
        signal,
    ]));
    const touchedEntityTargetKeys = new Set([...touchedTargetKeys].filter((key) => key.includes(":entity:")));
    if (options.signalWindow && touchedEntityTargetKeys.size > 0) {
        for (const signal of canonicalizeSignalEntityTargets(store, ctx, resolverScope, store.auditRepo.listSignals({
            agentId: ctx.agentId,
            ...(options.signalWindow.until ? { until: options.signalWindow.until } : {}),
        }))) {
            const key = beliefTargetKey({
                memoryKind: signal.memoryKind,
                contentRef: signal.contentRef,
                semanticKey: signal.semanticKey,
            });
            if (touchedEntityTargetKeys.has(key)) {
                signalsById.set(signal.signalId, signal);
            }
        }
    }
    const signals = [...signalsById.values()];
    const relevantExistingBeliefs = options.signalWindow
        ? existingBeliefs.filter((belief) => touchedTargetKeys.has(beliefTargetKey({
            memoryKind: belief.memoryKind,
            contentRef: belief.contentRef,
            semanticKey: belief.semanticKey,
        })) ||
            touchedFamilyKeys.has(beliefFamilyKey({
                scope: belief.scope,
                memoryKind: belief.memoryKind,
                semanticKey: belief.semanticKey,
            })))
        : existingBeliefs;
    if (signals.length === 0 && relevantExistingBeliefs.length === 0) {
        return {
            beliefsUpserted: 0,
            signalsProcessed: deltaSignals.length,
            beliefsNeedingReevaluation: 0,
            beliefsPromoted: 0,
            beliefsDemoted: 0,
            beliefsQuarantined: 0,
            beliefsSuperseded: 0,
            beliefsDecaying: 0,
        };
    }
    let beliefsUpserted = 0;
    let beliefsNeedingReevaluation = 0;
    const existingById = new Map(relevantExistingBeliefs.map((belief) => [belief.beliefId, belief]));
    const provisionalRecords = [];
    for (const group of mergeGroupsWithExisting(signals, relevantExistingBeliefs)) {
        const firstSignal = group.signals[0];
        const existingKeyBelief = relevantExistingBeliefs.find((belief) => beliefTargetKey({
            memoryKind: belief.memoryKind,
            contentRef: belief.contentRef,
            semanticKey: belief.semanticKey,
        }) ===
            beliefTargetKey({
                memoryKind: group.memoryKind,
                contentRef: group.contentRef,
                semanticKey: group.semanticKey,
            }));
        if (!firstSignal && !existingKeyBelief) {
            continue;
        }
        const snapshot = loadContentSnapshot(store, ctx.agentId, group.memoryKind, group.contentRef);
        const scope = snapshot?.scope ?? firstSignal?.scope ?? existingKeyBelief?.scope;
        if (!scope) {
            continue;
        }
        const canonicalBeliefId = buildBeliefId({
            agentId: ctx.agentId,
            scope,
            memoryKind: group.memoryKind,
            contentRef: group.contentRef,
            semanticKey: group.semanticKey,
        });
        const existing = existingById.get(canonicalBeliefId) ?? existingKeyBelief;
        const beliefId = existing?.beliefId ?? canonicalBeliefId;
        const summary = group.signals.length
            ? summarizeSignals(group.signals)
            : {
                retrievalSupportAvg: metadataNumber(existing?.metadataJson, "retrievalSupportAvg"),
                futureUsefulnessAvg: metadataNumber(existing?.metadataJson, "futureUsefulnessAvg"),
                outcomeFeedbackAvg: metadataNumber(existing?.metadataJson, "outcomeFeedbackAvg"),
                contradictionAvg: metadataNumber(existing?.metadataJson, "contradictionAvg"),
                selfConsistencyAvg: metadataNumber(existing?.metadataJson, "selfConsistencyAvg"),
                temporalStabilityAvg: metadataNumber(existing?.metadataJson, "temporalStabilityAvg"),
                assistantGroundingAvg: metadataNumber(existing?.metadataJson, "assistantGroundingAvg"),
                promotionAvg: metadataNumber(existing?.metadataJson, "promotionAvg"),
                demotionAvg: metadataNumber(existing?.metadataJson, "demotionAvg"),
                correctionAvg: metadataNumber(existing?.metadataJson, "correctionAvg"),
                repeatedUseAvg: metadataNumber(existing?.metadataJson, "repeatedUseAvg"),
                staleDecayAvg: metadataNumber(existing?.metadataJson, "staleDecayAvg"),
                useCount: existing?.useCount ?? 0,
                counts: existing?.metadataJson.signalCounts ?? {},
                lastUsedAt: existing?.lastUsedAt,
            };
        const priorConfidence = snapshot?.priorConfidence ??
            existing?.priorConfidence ??
            fallbackPriorConfidence(group.memoryKind);
        const sourceReliability = snapshot?.sourceReliability ??
            existing?.sourceReliability ??
            fallbackSourceReliability(group.memoryKind);
        const usefulnessScore = group.signals.length
            ? clamp01(summary.retrievalSupportAvg * 0.35 +
                summary.futureUsefulnessAvg * 0.25 +
                summary.repeatedUseAvg * 0.14 +
                Math.min(summary.useCount / 5, 1) * 0.26)
            : (existing?.usefulnessScore ?? 0);
        const stabilityScore = group.signals.length
            ? clamp01(sourceReliability * 0.45 +
                summary.selfConsistencyAvg * 0.3 +
                summary.temporalStabilityAvg * 0.15 +
                summary.retrievalSupportAvg * 0.1)
            : (existing?.stabilityScore ?? 0);
        const contradictionScore = clamp01(summary.contradictionAvg);
        const outcomeSupportScore = clamp01(summary.outcomeFeedbackAvg * 0.75 + summary.assistantGroundingAvg * 0.25);
        const posterior = posteriorConfidence({
            priorConfidence,
            usefulnessScore,
            stabilityScore,
            contradictionScore,
            outcomeSupportScore,
            selfConsistency: summary.selfConsistencyAvg,
            temporalStability: summary.temporalStabilityAvg,
            promotion: summary.promotionAvg,
            demotion: summary.demotionAvg,
            correction: summary.correctionAvg,
            repeatedUse: summary.repeatedUseAvg,
            staleDecay: summary.staleDecayAvg,
        });
        const firstSeenAt = minIso([existing?.firstSeenAt, snapshot?.firstSeenAt, firstSignal?.createdAt]) ?? ctx.now;
        const lastSeenAt = maxIso([
            existing?.lastSeenAt,
            snapshot?.lastSeenAt,
            ...group.signals.map((signal) => signal.createdAt),
        ]) ?? ctx.now;
        const signalEvidenceScore = signalEvidenceSupportScore(summary);
        const supportScore = clamp01(usefulnessScore * 0.35 +
            stabilityScore * 0.22 +
            outcomeSupportScore * 0.12 +
            summary.selfConsistencyAvg * 0.08 +
            summary.temporalStabilityAvg * 0.05 +
            signalEvidenceScore * 0.35);
        const inactiveAnchor = summary.lastUsedAt ?? lastSeenAt;
        const inactiveDays = daysBetween(inactiveAnchor, ctx.now);
        const record = {
            beliefId,
            agentId: ctx.agentId,
            scope,
            memoryKind: group.memoryKind,
            contentRef: group.contentRef,
            semanticKey: group.semanticKey,
            stage: existing?.stage ?? "candidate",
            priorConfidence,
            posteriorConfidence: posterior,
            usefulnessScore,
            stabilityScore,
            contradictionScore,
            outcomeSupportScore,
            sourceReliability,
            firstSeenAt,
            lastSeenAt,
            lastUsedAt: summary.lastUsedAt ?? existing?.lastUsedAt,
            useCount: Math.max(existing?.useCount ?? 0, summary.useCount),
            reevaluationDueAt: existing?.reevaluationDueAt,
            metadataJson: {
                signalCounts: summary.counts,
                retrievalSupportAvg: summary.retrievalSupportAvg,
                futureUsefulnessAvg: summary.futureUsefulnessAvg,
                outcomeFeedbackAvg: summary.outcomeFeedbackAvg,
                contradictionAvg: summary.contradictionAvg,
                selfConsistencyAvg: summary.selfConsistencyAvg,
                temporalStabilityAvg: summary.temporalStabilityAvg,
                assistantGroundingAvg: summary.assistantGroundingAvg,
                promotionAvg: summary.promotionAvg,
                demotionAvg: summary.demotionAvg,
                correctionAvg: summary.correctionAvg,
                repeatedUseAvg: summary.repeatedUseAvg,
                staleDecayAvg: summary.staleDecayAvg,
                signalEvidenceScore,
                supportScore,
                inactiveDays,
                contentSnapshotFound: Boolean(snapshot),
                entityScoped: isEntityScopedSemanticKey(group.semanticKey),
                canonicalEntityId: entityIdFromScopedSemanticKey(group.semanticKey),
                targetKeyAudit: [
                    ...new Map(group.signals
                        .map((signal) => signal.metadataJson.beliefTargetResolution)
                        .filter((value) => Boolean(value))
                        .map((value) => [JSON.stringify(value), value])).values(),
                ],
                posteriorScoreBreakdown: {
                    priorConfidence,
                    usefulnessScore,
                    stabilityScore,
                    contradictionScore,
                    outcomeSupportScore,
                    selfConsistency: summary.selfConsistencyAvg,
                    temporalStability: summary.temporalStabilityAvg,
                    promotion: summary.promotionAvg,
                    demotion: summary.demotionAvg,
                    correction: summary.correctionAvg,
                    repeatedUse: summary.repeatedUseAvg,
                    staleDecay: summary.staleDecayAvg,
                    signalEvidenceScore,
                    posterior,
                },
                supportContentRefs: [
                    ...new Set(group.signals.map((signal) => signalSupportContentRef(signal)).filter(Boolean)),
                ],
                lastAggregatedAt: ctx.now,
            },
            createdAt: existing?.createdAt ?? nowIso(new Date(firstSeenAt)),
            updatedAt: ctx.now,
        };
        provisionalRecords.push({
            record,
            summary,
            supportScore,
            inactiveDays,
            stageReason: "candidate-default",
        });
    }
    const stageRank = {
        candidate: 0,
        probationary: 1,
        active: 2,
        decaying: -1,
        superseded: -2,
        quarantined: -3,
    };
    for (const provisional of provisionalRecords) {
        const policy = stagePolicy(provisional.record.memoryKind);
        const stale = provisional.inactiveDays >= policy.decayAfterDays;
        const previousStage = existingById.get(provisional.record.beliefId)?.stage;
        const strongDemotion = provisional.summary.demotionAvg >= 0.88;
        const moderateDemotion = provisional.summary.demotionAvg >= 0.58;
        const strongCorrection = provisional.summary.correctionAvg >= 0.74;
        const moderateCorrection = provisional.summary.correctionAvg >= 0.48;
        const explicitStaleDecay = provisional.summary.staleDecayAvg >= 0.58;
        const contradictionTriggered = provisional.record.contradictionScore >= policy.quarantineContradiction ||
            (strongDemotion &&
                provisional.record.contradictionScore >=
                    Math.max(policy.quarantineContradiction * 0.55, 0.32));
        let stage = "candidate";
        let reason = "newly-observed";
        if (contradictionTriggered) {
            stage = "quarantined";
            reason = "high-contradiction";
        }
        else if (strongCorrection) {
            stage = "superseded";
            reason = "explicit-correction-superseded";
        }
        else if (previousStage === "quarantined") {
            // Recovery: contradiction dropped below threshold on reevaluation.
            stage = "candidate";
            reason = "quarantine-recovery";
        }
        else if (previousStage === "superseded") {
            // Recovery: superseded belief re-enters as candidate so it can re-compete
            // in the family supersession pass below.
            if (provisional.record.posteriorConfidence >= policy.probationaryPosterior &&
                provisional.supportScore >= policy.minSupportForProbationary) {
                stage = "probationary";
                reason = "supersession-recovery-probationary";
            }
            else {
                stage = "candidate";
                reason = "supersession-recovery";
            }
        }
        else if (moderateCorrection) {
            stage = "decaying";
            reason = "explicit-correction-decay";
        }
        else if (explicitStaleDecay) {
            stage = "decaying";
            reason = "explicit-stale-decay";
        }
        else if (moderateDemotion) {
            if (stale ||
                previousStage === "active" ||
                previousStage === "probationary" ||
                previousStage === "decaying") {
                stage = "decaying";
                reason = "demotion-soft-decay";
            }
            else if (provisional.record.posteriorConfidence >= policy.probationaryPosterior &&
                provisional.supportScore >= policy.minSupportForProbationary) {
                stage = "probationary";
                reason = "demotion-capped-probationary";
            }
            else {
                stage = "candidate";
                reason = "demotion-limited-support";
            }
        }
        else if (provisional.record.posteriorConfidence >= policy.activePosterior &&
            provisional.supportScore >= policy.minSupportForActive &&
            (!stale ||
                provisional.record.memoryKind === "fact" ||
                provisional.record.stabilityScore >= 0.82)) {
            stage = "active";
            reason = "strong-support";
        }
        else if (stale &&
            (existingById.get(provisional.record.beliefId)?.stage === "active" ||
                existingById.get(provisional.record.beliefId)?.stage === "probationary" ||
                existingById.get(provisional.record.beliefId)?.stage === "decaying")) {
            stage = "decaying";
            reason = "stale-without-fresh-support";
        }
        else if (provisional.record.posteriorConfidence >= policy.probationaryPosterior &&
            provisional.supportScore >= policy.minSupportForProbationary) {
            stage = "probationary";
            reason = "moderate-support";
        }
        provisional.record.stage = stage;
        provisional.stageReason = reason;
    }
    const families = new Map();
    for (const provisional of provisionalRecords) {
        const familyKey = `${provisional.record.scope}:${provisional.record.memoryKind}:${provisional.record.semanticKey}`;
        const bucket = families.get(familyKey) ?? [];
        bucket.push(provisional);
        families.set(familyKey, bucket);
    }
    for (const bucket of families.values()) {
        if (bucket.length < 2) {
            continue;
        }
        const dominant = [...bucket]
            .filter((entry) => entry.record.stage !== "quarantined")
            .sort((left, right) => {
            if (right.record.posteriorConfidence !== left.record.posteriorConfidence) {
                return right.record.posteriorConfidence - left.record.posteriorConfidence;
            }
            if (right.supportScore !== left.supportScore) {
                return right.supportScore - left.supportScore;
            }
            return stageRank[right.record.stage] - stageRank[left.record.stage];
        })[0];
        if (!dominant) {
            continue;
        }
        const policy = stagePolicy(dominant.record.memoryKind);
        for (const provisional of bucket) {
            if (provisional.record.beliefId === dominant.record.beliefId ||
                provisional.record.stage === "quarantined" ||
                dominant.record.posteriorConfidence - provisional.record.posteriorConfidence <
                    policy.supersessionGap ||
                dominant.record.posteriorConfidence < policy.probationaryPosterior) {
                continue;
            }
            provisional.record.stage = "superseded";
            provisional.record.reevaluationDueAt = addDays(ctx.now, 30);
            provisional.stageReason = `superseded-by:${dominant.record.beliefId}`;
            provisional.record.metadataJson = {
                ...provisional.record.metadataJson,
                supersededByBeliefId: dominant.record.beliefId,
            };
        }
    }
    let beliefsPromoted = 0;
    let beliefsDemoted = 0;
    let beliefsQuarantined = 0;
    let beliefsSuperseded = 0;
    let beliefsDecaying = 0;
    for (const provisional of provisionalRecords) {
        const existing = existingById.get(provisional.record.beliefId);
        const previousStage = existing?.stage;
        const sourceEpoch = ctx.readEpoch ?? store.client.currentMemoryEpoch(ctx.agentId);
        const materializedEpoch = store.client.nextMemoryEpoch(ctx.agentId, ctx.now);
        if (provisional.record.stage === "quarantined") {
            provisional.record.reevaluationDueAt = addDays(ctx.now, 7);
            beliefsQuarantined += 1;
        }
        else if (provisional.record.stage === "decaying") {
            provisional.record.reevaluationDueAt = addDays(ctx.now, 14);
            beliefsDecaying += 1;
        }
        else if (provisional.record.stage === "superseded") {
            provisional.record.reevaluationDueAt =
                provisional.record.reevaluationDueAt ?? addDays(ctx.now, 30);
            beliefsSuperseded += 1;
        }
        else if (provisional.summary.demotionAvg >= 0.58) {
            provisional.record.reevaluationDueAt = addDays(ctx.now, 7);
        }
        else if (provisional.record.contradictionScore >= 0.45) {
            provisional.record.reevaluationDueAt = addDays(provisional.record.lastSeenAt, 7);
        }
        if (provisional.record.reevaluationDueAt) {
            beliefsNeedingReevaluation += 1;
        }
        if (previousStage && previousStage !== provisional.record.stage) {
            if (stageRank[provisional.record.stage] > stageRank[previousStage]) {
                beliefsPromoted += 1;
            }
            else {
                beliefsDemoted += 1;
            }
        }
        provisional.record.metadataJson = {
            ...provisional.record.metadataJson,
            stageReason: provisional.stageReason,
            previousStage: previousStage ?? null,
            stageTransitionAt: previousStage && previousStage !== provisional.record.stage ? ctx.now : undefined,
        };
        provisional.record.derivedFromMinEpoch = provisional.record.derivedFromMinEpoch ?? sourceEpoch;
        provisional.record.derivedFromMaxEpoch = provisional.record.derivedFromMaxEpoch ?? sourceEpoch;
        provisional.record.materializedEpoch = materializedEpoch;
        store.beliefRepo.upsert(provisional.record);
        beliefsUpserted += 1;
    }
    return {
        beliefsUpserted,
        signalsProcessed: options.signalWindow ? deltaSignals.length : signals.length,
        beliefsNeedingReevaluation,
        beliefsPromoted,
        beliefsDemoted,
        beliefsQuarantined,
        beliefsSuperseded,
        beliefsDecaying,
    };
}
