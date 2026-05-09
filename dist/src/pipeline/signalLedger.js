import { clamp01, normalizeText, randomId, stableHash } from "../support.js";
function recordSignal(store, ctx, params) {
    store.auditRepo.recordSignal({
        signalId: params.signalId ?? randomId("signal"),
        agentId: ctx.agentId,
        scope: ctx.scopes.join(","),
        sessionKey: ctx.sessionKey,
        signalType: params.signalType,
        memoryKind: params.memoryKind,
        contentRef: params.contentRef,
        semanticKey: params.semanticKey,
        value: clamp01(params.value),
        sourceRef: params.sourceRef,
        metadataJson: params.metadataJson,
        createdAt: ctx.now,
    });
}
function average(values) {
    if (values.length === 0) {
        return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function daysBetween(earlierIso, laterIso) {
    const deltaMs = Date.parse(laterIso) - Date.parse(earlierIso);
    return Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs / 86_400_000 : 0;
}
function dayBucket(iso) {
    return iso.slice(0, 10);
}
function sourceFamily(sourceRef) {
    return sourceRef.split(":")[0]?.trim() || sourceRef;
}
function beliefSignalGroupKey(params) {
    const contentRef = params.semanticKey.startsWith("entity:") ? undefined : params.contentRef;
    return `${params.memoryKind}:${contentRef ?? params.semanticKey}`;
}
function maintenanceSignalId(params) {
    return stableHash([
        "maintenance-signal",
        params.agentId,
        params.beliefId,
        params.signalType,
        params.bucket,
    ]);
}
function temporalStabilityWindowDays(memoryKind) {
    switch (memoryKind) {
        case "state":
            return 5;
        case "task":
            return 7;
        case "fact":
            return 30;
        case "event":
            return 14;
        case "graph_edge":
            return 45;
        case "chunk":
            return 3;
        case "strategy":
            return 45;
    }
}
function futureUsefulnessValue(params) {
    const rankBonus = Math.max(0, 0.18 - (params.rank ?? 0) * 0.035);
    const confidenceBoost = clamp01(params.routeConfidence ?? 0) * 0.2;
    const recallModeBias = params.recallMode === "full" ? 0.16 : 0.08;
    return clamp01(params.supportValue * 0.42 + confidenceBoost + rankBonus + recallModeBias);
}
function summarizeBeliefSignals(signals) {
    const positiveSignals = signals.filter((signal) => signal.signalType === "retrieval_support" ||
        signal.signalType === "future_usefulness" ||
        signal.signalType === "outcome_feedback" ||
        signal.signalType === "assistant_grounding" ||
        signal.signalType === "promotion");
    const contradictionSignals = signals.filter((signal) => signal.signalType === "contradiction");
    return {
        positiveSignals,
        contradictionSignals,
        distinctSupportDays: new Set(positiveSignals.map((signal) => dayBucket(signal.createdAt))).size,
        distinctSupportSources: new Set(positiveSignals.map((signal) => sourceFamily(signal.sourceRef)))
            .size,
        positiveAverage: average(positiveSignals.map((signal) => signal.value)),
        contradictionAverage: average(contradictionSignals.map((signal) => signal.value)),
    };
}
function summarizeOutcomeEvidenceRoles(chunks) {
    const assistantCount = chunks.filter((chunk) => chunk.role === "assistant").length;
    const userCount = chunks.filter((chunk) => chunk.role === "user").length;
    const toolCount = chunks.filter((chunk) => chunk.role === "tool").length;
    const nonAssistantCount = userCount + toolCount;
    return {
        assistantCount,
        userCount,
        toolCount,
        nonAssistantCount,
        hasAssistantEvidence: assistantCount > 0,
        hasUserEvidence: userCount > 0,
        hasToolEvidence: toolCount > 0,
        hasNonAssistantGrounding: nonAssistantCount > 0,
    };
}
function signalTargetForTaskOutcome(task, outcome) {
    return {
        memoryKind: "task",
        contentRef: task.taskId,
        semanticKey: `task_outcome:${normalizeText(task.taskId)}:${outcome.outcomeKey}`,
    };
}
function signalTargetForStateRow(row) {
    return {
        memoryKind: "state",
        contentRef: row.id,
        semanticKey: `state:${normalizeText(row.id)}`,
    };
}
function signalTargetForTaskRow(row) {
    return {
        memoryKind: "task",
        contentRef: row.id,
        semanticKey: `task:${normalizeText(row.id)}`,
    };
}
function signalTargetForGraphEdge(edge) {
    const src = edge.srcEntityId ?? edge.srcNodeId;
    const dst = edge.dstEntityId ?? edge.dstNodeId;
    return {
        memoryKind: "graph_edge",
        contentRef: edge.edgeId,
        semanticKey: `entity:${src}:graph_edge:${edge.relType}:entity:${dst}`,
    };
}
function signalTargetForGraphEdgeId(store, ctx, edgeId) {
    if (!edgeId) {
        return null;
    }
    const row = store.client
        .prepare(`SELECT edge_id AS edgeId,
              src_entity_id AS srcEntityId,
              rel_type AS relType,
              dst_entity_id AS dstEntityId,
              confidence
         FROM graph_edges
        WHERE agent_id = ?
          AND edge_id = ?
        LIMIT 1`)
        .get(ctx.agentId, edgeId);
    if (!row) {
        return null;
    }
    return {
        memoryKind: "graph_edge",
        contentRef: row.edgeId,
        semanticKey: `entity:${row.srcEntityId}:graph_edge:${row.relType}:entity:${row.dstEntityId}`,
    };
}
function signalTargetForNormalizedState(state) {
    return {
        memoryKind: "state",
        contentRef: `${state.scope}:${state.key}`,
        semanticKey: `state:${normalizeText(state.key)}`,
    };
}
function signalTargetForNormalizedFact(fact) {
    return {
        memoryKind: "fact",
        contentRef: fact.factId,
        semanticKey: `fact:${normalizeText(fact.canonicalSubject)}:${fact.predicate}`,
    };
}
function signalTargetForNormalizedEvent(event) {
    return {
        memoryKind: "event",
        contentRef: event.eventId,
        semanticKey: `event:${normalizeText(event.eventType)}:${normalizeText(event.normalizedText).slice(0, 96)}`,
    };
}
function signalTargetForNormalizedGraphEdge(edge) {
    return {
        memoryKind: "graph_edge",
        contentRef: edge.edgeId,
        semanticKey: `entity:${edge.srcEntityId}:graph_edge:${edge.relType}:entity:${edge.dstEntityId}`,
    };
}
function writeSignalId(params) {
    return stableHash([
        "write-materialization-signal",
        params.agentId,
        params.signalType,
        params.memoryKind,
        params.contentRef ?? "",
        params.semanticKey,
        params.sourceRef,
    ]);
}
function emitWriteSignal(store, ctx, params) {
    recordSignal(store, ctx, {
        signalId: writeSignalId({
            agentId: ctx.agentId,
            signalType: params.signalType,
            memoryKind: params.target.memoryKind,
            contentRef: params.target.contentRef,
            semanticKey: params.target.semanticKey,
            sourceRef: params.sourceRef,
        }),
        signalType: params.signalType,
        memoryKind: params.target.memoryKind,
        contentRef: params.target.contentRef,
        semanticKey: params.target.semanticKey,
        value: params.value,
        sourceRef: params.sourceRef,
        metadataJson: params.metadataJson,
    });
}
export function emitWriteMaterializationSignals(store, ctx, params) {
    for (const state of params.states ?? []) {
        emitWriteSignal(store, ctx, {
            target: signalTargetForNormalizedState(state),
            signalType: "promotion",
            value: state.confidence,
            sourceRef: state.sourceRef,
            metadataJson: {
                emittedBy: "write_materialization",
                materializedEpoch: params.materializedEpoch ?? state.materializedEpoch,
                stateKind: state.stateKind,
            },
        });
    }
    for (const fact of params.facts ?? []) {
        emitWriteSignal(store, ctx, {
            target: signalTargetForNormalizedFact(fact),
            signalType: "promotion",
            value: fact.confidence,
            sourceRef: fact.sourceRef,
            metadataJson: {
                emittedBy: "write_materialization",
                materializedEpoch: params.materializedEpoch ?? fact.materializedEpoch,
                predicate: fact.predicate,
                status: fact.status,
            },
        });
    }
    for (const event of params.events ?? []) {
        emitWriteSignal(store, ctx, {
            target: signalTargetForNormalizedEvent(event),
            signalType: "promotion",
            value: event.confidence,
            sourceRef: event.sourceRef,
            metadataJson: {
                emittedBy: "write_materialization",
                materializedEpoch: params.materializedEpoch ?? event.materializedEpoch,
                eventType: event.eventType,
                sourceKind: event.sourceKind,
            },
        });
    }
    for (const edge of params.graphEdges ?? []) {
        emitWriteSignal(store, ctx, {
            target: signalTargetForNormalizedGraphEdge(edge),
            signalType: "promotion",
            value: edge.confidence,
            sourceRef: edge.evidenceRef,
            metadataJson: {
                emittedBy: "write_materialization",
                materializedEpoch: params.materializedEpoch ?? edge.materializedEpoch,
                relType: edge.relType,
            },
        });
    }
}
export function signalTargetForMemoryObject(object) {
    switch (object.kind) {
        case "state":
            return signalTargetForStateRow(object.row);
        case "task":
            return signalTargetForTaskRow(object.row);
        case "fact": {
            const subject = object.attributes.factSubject?.trim();
            const predicate = object.attributes.factPredicate?.trim();
            const semanticKey = subject && predicate
                ? `fact:${normalizeText(subject)}:${predicate}`
                : `fact:${normalizeText(object.row.id)}`;
            return {
                memoryKind: "fact",
                contentRef: object.row.id,
                semanticKey,
            };
        }
        case "event":
            return {
                memoryKind: "event",
                contentRef: object.row.id,
                semanticKey: `event:${normalizeText(object.row.id)}`,
            };
        case "chunk":
            return {
                memoryKind: "chunk",
                contentRef: object.row.id,
                semanticKey: `chunk:${normalizeText(object.row.id)}`,
            };
        default:
            return null;
    }
}
function idAfterPrefix(value, prefix) {
    if (!value?.startsWith(prefix)) {
        return undefined;
    }
    const rest = value.slice(prefix.length).trim();
    if (!rest) {
        return undefined;
    }
    const separator = rest.indexOf(":");
    return separator >= 0 ? rest.slice(0, separator) : rest;
}
function canonicalOrSourceId(entry, kind) {
    if (entry.lineage?.canonicalKind === kind && entry.lineage.canonicalId) {
        return entry.lineage.canonicalId;
    }
    if (entry.lineage?.sourceKind === kind && entry.lineage.sourceId) {
        return entry.lineage.sourceId;
    }
    return undefined;
}
function signalTargetForPromptEvidence(store, ctx, entry) {
    const factId = canonicalOrSourceId(entry, "fact") ??
        idAfterPrefix(entry.id, "fact:") ??
        (entry.surface === "fact" ? entry.id : undefined);
    if (factId) {
        const fact = store.factRepo.get(factId);
        if (fact) {
            return signalTargetForNormalizedFact(fact);
        }
    }
    const eventId = canonicalOrSourceId(entry, "event") ??
        idAfterPrefix(entry.id, "event:") ??
        (entry.surface === "event" ? entry.id : undefined);
    if (eventId) {
        const event = store.eventRepo.get(eventId);
        if (event) {
            return signalTargetForNormalizedEvent(event);
        }
    }
    const graphEdgeId = canonicalOrSourceId(entry, "graph_edge") ??
        idAfterPrefix(entry.id, "edge:") ??
        idAfterPrefix(entry.id, "graph:");
    const graphTarget = signalTargetForGraphEdgeId(store, ctx, graphEdgeId);
    if (graphTarget) {
        return graphTarget;
    }
    const stateKey = canonicalOrSourceId(entry, "state") ??
        idAfterPrefix(entry.id, "state:") ??
        (entry.metadata && typeof entry.metadata.stateKey === "string" ? entry.metadata.stateKey : undefined);
    if (stateKey) {
        const [state] = store.stateRepo.get({
            agentId: ctx.agentId,
            scopes: ctx.scopes,
            key: stateKey,
            now: ctx.now,
        });
        if (state) {
            return signalTargetForNormalizedState(state);
        }
    }
    const chunkId = canonicalOrSourceId(entry, "chunk") ??
        (entry.lineage?.sourceKind === "chunk" ? entry.lineage.sourceId : undefined) ??
        idAfterPrefix(entry.id, "source-expansion:") ??
        idAfterPrefix(entry.id, "event:chunk:") ??
        idAfterPrefix(entry.id, "chunk:") ??
        (entry.surface === "chunk" ? entry.id : undefined);
    if (chunkId) {
        const chunk = store.chunkRepo.get(chunkId);
        if (chunk) {
            return {
                memoryKind: "chunk",
                contentRef: chunk.chunkId,
                semanticKey: `chunk:${normalizeText(chunk.chunkId)}`,
            };
        }
    }
    return null;
}
function promptEvidenceSignalSourceRef(entry, auditSourceRef) {
    if (entry.sourceRef?.trim()) {
        return entry.sourceRef.trim();
    }
    if (entry.lineage?.sourceRef?.trim()) {
        return entry.lineage.sourceRef.trim();
    }
    const merged = entry.mergedSourceRefs?.find((sourceRef) => sourceRef.trim());
    return merged?.trim() ?? auditSourceRef;
}
function promptEvidenceSupportValue(entry) {
    return clamp01(entry.injectionScore ??
        entry.grade?.finalScore ??
        entry.priority ??
        entry.semanticScore ??
        entry.goalScore ??
        0.5);
}
function emitRetrievalSignalPair(store, ctx, params) {
    const baseMetadata = {
        routeType: params.routeType,
        recallMode: params.recallMode,
        ...params.metadataJson,
    };
    const usefulnessValue = futureUsefulnessValue({
        supportValue: params.supportValue,
        routeConfidence: typeof params.metadataJson.routeConfidence === "number"
            ? params.metadataJson.routeConfidence
            : undefined,
        rank: typeof params.metadataJson.rank === "number" ? params.metadataJson.rank : undefined,
        recallMode: params.recallMode,
    });
    recordSignal(store, ctx, {
        signalType: "retrieval_support",
        memoryKind: params.target.memoryKind,
        contentRef: params.target.contentRef,
        semanticKey: params.target.semanticKey,
        value: params.supportValue,
        sourceRef: params.sourceRef,
        metadataJson: {
            ...baseMetadata,
            supportValue: clamp01(params.supportValue),
        },
    });
    recordSignal(store, ctx, {
        signalType: "future_usefulness",
        memoryKind: params.target.memoryKind,
        contentRef: params.target.contentRef,
        semanticKey: params.target.semanticKey,
        value: usefulnessValue,
        sourceRef: params.sourceRef,
        metadataJson: {
            ...baseMetadata,
            usefulnessValue,
        },
    });
}
export function emitBackgroundRetrievalSignals(store, ctx, params) {
    const sourceRef = `audit:${params.auditId}`;
    for (const [rank, row] of params.bundle.states.entries()) {
        emitRetrievalSignalPair(store, ctx, {
            target: signalTargetForStateRow(row),
            sourceRef,
            routeType: params.routeType,
            recallMode: "background-only",
            supportValue: row.score,
            metadataJson: { rank, rowId: row.id },
        });
    }
    for (const [rank, row] of params.bundle.tasks.entries()) {
        emitRetrievalSignalPair(store, ctx, {
            target: signalTargetForTaskRow(row),
            sourceRef,
            routeType: params.routeType,
            recallMode: "background-only",
            supportValue: row.score,
            metadataJson: { rank, rowId: row.id },
        });
    }
}
export function emitFullRetrievalSignals(store, ctx, params) {
    const selectedStateIds = new Set(params.bundle.states.map((row) => row.id));
    const selectedTaskIds = new Set(params.bundle.tasks.map((row) => row.id));
    const selectedFactIds = new Set(params.bundle.facts.map((row) => row.id));
    const selectedEventIds = new Set(params.bundle.events.map((row) => row.id));
    const recalledChunkIds = new Set(params.bundle.recalledChunkIds);
    const sourceRef = `audit:${params.auditId}`;
    const emittedTargets = new Set();
    const emitOnce = (paramsForSignal) => {
        const key = [
            paramsForSignal.target.memoryKind,
            paramsForSignal.target.contentRef ?? "",
            paramsForSignal.target.semanticKey,
        ].join("\u0000");
        if (emittedTargets.has(key)) {
            return;
        }
        emittedTargets.add(key);
        emitRetrievalSignalPair(store, ctx, {
            target: paramsForSignal.target,
            sourceRef: paramsForSignal.signalSourceRef,
            routeType: params.bundle.routeType,
            recallMode: "full",
            supportValue: paramsForSignal.supportValue,
            metadataJson: paramsForSignal.metadataJson,
        });
    };
    for (const [rank, entry] of params.scheduled.entries()) {
        const target = signalTargetForMemoryObject(entry.object);
        if (!target) {
            continue;
        }
        const rowId = entry.object.row.id;
        const selected = (entry.object.kind === "state" && selectedStateIds.has(rowId)) ||
            (entry.object.kind === "task" && selectedTaskIds.has(rowId)) ||
            (entry.object.kind === "fact" && selectedFactIds.has(rowId)) ||
            (entry.object.kind === "event" && selectedEventIds.has(rowId)) ||
            (entry.object.kind === "chunk" && recalledChunkIds.has(rowId));
        if (!selected) {
            continue;
        }
        emitOnce({
            target,
            signalSourceRef: sourceRef,
            supportValue: entry.objectiveScore,
            metadataJson: {
                rank,
                routeConfidence: params.bundle.routeConfidence,
                rowId,
            },
        });
    }
    for (const [rank, edge] of params.bundle.graph.edges.entries()) {
        emitOnce({
            target: signalTargetForGraphEdge(edge),
            signalSourceRef: sourceRef,
            supportValue: edge.confidence,
            metadataJson: {
                rank,
                routeConfidence: params.bundle.routeConfidence,
                relType: edge.relType,
                evidenceRef: edge.evidenceRef ?? null,
            },
        });
    }
    const injectedPromptEvidence = params.bundle.promptEvidence.filter((entry) => entry.injected === true || (entry.role === "protected" && !entry.dropReason));
    for (const [rank, entry] of injectedPromptEvidence.entries()) {
        const target = signalTargetForPromptEvidence(store, ctx, entry);
        if (!target) {
            continue;
        }
        emitOnce({
            target,
            signalSourceRef: promptEvidenceSignalSourceRef(entry, sourceRef),
            supportValue: promptEvidenceSupportValue(entry),
            metadataJson: {
                rank,
                routeConfidence: params.bundle.routeConfidence,
                auditRef: sourceRef,
                emittedBy: "prompt_evidence",
                candidateId: entry.id,
                packetId: entry.packetId ?? null,
                surface: entry.surface,
                promptRole: entry.role,
                injected: entry.injected === true,
                selectionReason: entry.selectionReason ?? null,
                evidenceSourceRef: entry.sourceRef ?? entry.lineage?.sourceRef ?? null,
            },
        });
    }
}
function loadFactSignalRows(store, factIds) {
    if (factIds.length === 0) {
        return [];
    }
    const placeholders = factIds.map(() => "?").join(", ");
    return store.client
        .prepare(`SELECT fact_id AS factId,
              canonical_subject AS canonicalSubject,
              predicate,
              canonical_object AS canonicalObject
         FROM facts
        WHERE fact_id IN (${placeholders})`)
        .all(...factIds);
}
export function emitContradictionSignals(store, ctx, params) {
    const contradictionEdges = params.graphEdges.filter((edge) => edge.relType === "contradicts");
    if (contradictionEdges.length === 0) {
        return;
    }
    const sourceRef = `contradiction:${stableHash([params.routeType, params.query, ctx.now])}`;
    for (const edge of contradictionEdges) {
        const factIds = (edge.evidenceRef ?? "")
            .split("|")
            .map((value) => value.trim())
            .filter(Boolean);
        const factRows = loadFactSignalRows(store, factIds);
        for (const row of factRows) {
            recordSignal(store, ctx, {
                signalType: "contradiction",
                memoryKind: "fact",
                contentRef: row.factId,
                semanticKey: `fact:${normalizeText(row.canonicalSubject)}:${row.predicate}`,
                value: edge.confidence,
                sourceRef,
                metadataJson: {
                    routeType: params.routeType,
                    edgeId: edge.edgeId,
                    relType: edge.relType,
                    conflictingFactIds: factIds,
                    canonicalObject: row.canonicalObject,
                },
            });
        }
    }
}
export function emitOutcomeFeedbackSignal(store, ctx, params) {
    const value = params.emitted
        ? clamp01(params.outcome.promotionScore || params.outcome.confidence)
        : clamp01((params.outcome.promotionScore || params.outcome.confidence) * 0.5);
    recordSignal(store, ctx, {
        signalType: "outcome_feedback",
        memoryKind: "task",
        contentRef: params.task.taskId,
        semanticKey: `task_outcome:${normalizeText(params.task.taskId)}:${params.outcome.outcomeKey}`,
        value,
        sourceRef: `task-outcome:${params.task.taskId}`,
        metadataJson: {
            emitted: params.emitted,
            eventType: params.outcome.eventType,
            phase: params.outcome.phase,
            outcomeKey: params.outcome.outcomeKey,
            closureScore: params.outcome.closureScore,
            verificationScore: params.outcome.verificationScore,
            contradictionRisk: params.outcome.contradictionRisk,
            promotionScore: params.outcome.promotionScore,
            evidenceChunkIds: params.outcome.evidenceChunkIds,
        },
    });
}
export function emitAssistantOutcomeLearningSignals(store, ctx, params) {
    const roles = summarizeOutcomeEvidenceRoles(params.evidenceChunks);
    if (!roles.hasAssistantEvidence) {
        return;
    }
    const target = signalTargetForTaskOutcome(params.task, params.outcome);
    const sourceRef = `task-outcome:${params.task.taskId}`;
    const baseMetadata = {
        outcomeKey: params.outcome.outcomeKey,
        phase: params.outcome.phase,
        emitted: params.emitted,
        shouldPromote: params.shouldPromote,
        reason: params.reason,
        promotionScore: params.outcome.promotionScore,
        confidence: params.outcome.confidence,
        closureScore: params.outcome.closureScore,
        verificationScore: params.outcome.verificationScore,
        contradictionRisk: params.outcome.contradictionRisk,
        evidenceChunkIds: params.outcome.evidenceChunkIds,
        assistantCount: roles.assistantCount,
        userCount: roles.userCount,
        toolCount: roles.toolCount,
        nonAssistantCount: roles.nonAssistantCount,
        hasUserEvidence: roles.hasUserEvidence,
        hasToolEvidence: roles.hasToolEvidence,
        hasNonAssistantGrounding: roles.hasNonAssistantGrounding,
    };
    if (roles.hasNonAssistantGrounding) {
        const groundingEvidenceStrength = roles.hasToolEvidence
            ? 1
            : roles.hasUserEvidence
                ? 0.82
                : 0.68;
        const groundingValue = clamp01(groundingEvidenceStrength *
            (0.45 +
                params.outcome.verificationScore * 0.3 +
                params.outcome.closureScore * 0.25 -
                params.outcome.contradictionRisk * 0.15));
        recordSignal(store, ctx, {
            signalType: "assistant_grounding",
            memoryKind: target.memoryKind,
            contentRef: target.contentRef,
            semanticKey: target.semanticKey,
            value: groundingValue,
            sourceRef,
            metadataJson: baseMetadata,
        });
    }
    if (params.shouldPromote) {
        const promotionValue = clamp01((params.outcome.promotionScore || params.outcome.confidence) *
            (roles.hasNonAssistantGrounding ? 1 : 0.4) *
            (params.emitted ? 1 : 0.6));
        recordSignal(store, ctx, {
            signalType: "promotion",
            memoryKind: target.memoryKind,
            contentRef: target.contentRef,
            semanticKey: target.semanticKey,
            value: promotionValue,
            sourceRef,
            metadataJson: baseMetadata,
        });
        return;
    }
    const demotionValue = clamp01((1 - (params.outcome.promotionScore || params.outcome.confidence)) * 0.65 +
        params.outcome.contradictionRisk * 0.25 +
        (roles.hasNonAssistantGrounding ? 0 : 0.1));
    recordSignal(store, ctx, {
        signalType: "demotion",
        memoryKind: target.memoryKind,
        contentRef: target.contentRef,
        semanticKey: target.semanticKey,
        value: demotionValue,
        sourceRef,
        metadataJson: baseMetadata,
    });
}
export function emitBeliefMaintenanceSignals(store, ctx) {
    const beliefs = store.beliefRepo
        .listByAgent({ agentId: ctx.agentId })
        .filter((belief) => ctx.scopes.includes(belief.scope));
    if (beliefs.length === 0) {
        return;
    }
    const groupedSignals = new Map();
    for (const signal of store.auditRepo.listSignals({ agentId: ctx.agentId })) {
        const key = beliefSignalGroupKey({
            memoryKind: signal.memoryKind,
            contentRef: signal.contentRef,
            semanticKey: signal.semanticKey,
        });
        const bucket = groupedSignals.get(key) ?? [];
        bucket.push(signal);
        groupedSignals.set(key, bucket);
    }
    for (const belief of beliefs) {
        if (belief.memoryKind === "strategy" ||
            belief.stage === "quarantined" ||
            belief.stage === "superseded") {
            continue;
        }
        const key = beliefSignalGroupKey({
            memoryKind: belief.memoryKind,
            contentRef: belief.contentRef,
            semanticKey: belief.semanticKey,
        });
        const summary = summarizeBeliefSignals(groupedSignals.get(key) ?? []);
        const bucket = dayBucket(ctx.now);
        if (summary.positiveSignals.length >= 2 &&
            (summary.distinctSupportDays >= 2 ||
                summary.distinctSupportSources >= 2 ||
                belief.useCount >= 2)) {
            const selfConsistencyValue = clamp01(summary.positiveAverage * 0.44 +
                Math.min(summary.positiveSignals.length / 4, 1) * 0.2 +
                Math.min(summary.distinctSupportDays / 3, 1) * 0.22 +
                Math.min(summary.distinctSupportSources / 3, 1) * 0.14 -
                summary.contradictionAverage * 0.22);
            if (selfConsistencyValue > 0.25) {
                recordSignal(store, ctx, {
                    signalId: maintenanceSignalId({
                        agentId: ctx.agentId,
                        beliefId: belief.beliefId,
                        signalType: "self_consistency",
                        bucket,
                    }),
                    signalType: "self_consistency",
                    memoryKind: belief.memoryKind,
                    contentRef: belief.contentRef,
                    semanticKey: belief.semanticKey,
                    value: selfConsistencyValue,
                    sourceRef: `maintenance:self-consistency:${belief.beliefId}:${bucket}`,
                    metadataJson: {
                        distinctSupportDays: summary.distinctSupportDays,
                        distinctSupportSources: summary.distinctSupportSources,
                        positiveSignalCount: summary.positiveSignals.length,
                    },
                });
            }
        }
        const ageDays = daysBetween(belief.firstSeenAt, ctx.now);
        const windowDays = temporalStabilityWindowDays(belief.memoryKind);
        const stabilityEligible = ageDays >= windowDays &&
            summary.contradictionAverage < 0.35 &&
            belief.stage !== "candidate" &&
            (summary.positiveSignals.length >= 2 ||
                summary.distinctSupportDays >= 2 ||
                belief.useCount >= 3);
        if (stabilityEligible) {
            const temporalValue = clamp01(Math.min(ageDays / Math.max(windowDays * 2, 1), 1) * 0.44 +
                summary.positiveAverage * 0.22 +
                Math.min(summary.distinctSupportDays / 3, 1) * 0.12 +
                (1 - summary.contradictionAverage) * 0.14 +
                (belief.stage === "active" ? 0.08 : belief.stage === "probationary" ? 0.04 : 0));
            if (temporalValue > 0.24) {
                recordSignal(store, ctx, {
                    signalId: maintenanceSignalId({
                        agentId: ctx.agentId,
                        beliefId: belief.beliefId,
                        signalType: "temporal_stability",
                        bucket,
                    }),
                    signalType: "temporal_stability",
                    memoryKind: belief.memoryKind,
                    contentRef: belief.contentRef,
                    semanticKey: belief.semanticKey,
                    value: temporalValue,
                    sourceRef: `maintenance:temporal-stability:${belief.beliefId}:${bucket}`,
                    metadataJson: {
                        ageDays,
                        windowDays,
                        distinctSupportDays: summary.distinctSupportDays,
                        contradictionAverage: summary.contradictionAverage,
                    },
                });
            }
        }
    }
}
