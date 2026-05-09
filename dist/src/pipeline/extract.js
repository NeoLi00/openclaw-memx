import { stripInjectedHistoricalBlock } from "../security/escaping.js";
import { randomId, truncateText } from "../support.js";
import { analyzeSemanticHints, extractTimeHints, hasExplicitRememberIntent as detectExplicitRememberIntent, inferEntityNames, } from "./semantics.js";
function toTextBlocks(content) {
    if (typeof content === "string") {
        return [content];
    }
    if (!Array.isArray(content)) {
        return [];
    }
    const result = [];
    for (const block of content) {
        if (!block || typeof block !== "object") {
            continue;
        }
        const entry = block;
        if (entry.type === "text" && typeof entry.text === "string") {
            result.push(entry.text);
        }
    }
    return result;
}
function structuredHints(text) {
    const analyzed = analyzeSemanticHints(text);
    const workflows = analyzed.workflows;
    const relations = analyzed.relations.length > 0
        ? analyzed.relations
        : analyzed.relation
            ? [analyzed.relation]
            : [];
    return {
        entities: analyzed.entities.length > 0 ? analyzed.entities : inferEntityNames(text),
        timeHints: analyzed.timeHints.length > 0 ? analyzed.timeHints : extractTimeHints(text),
        ...(analyzed.preference
            ? {
                preferenceHint: true,
                preference: analyzed.preference,
            }
            : {}),
        ...(workflows.length > 0
            ? {
                taskStateHint: true,
                workflow: workflows[0],
                workflows,
            }
            : {}),
        ...(relations.length > 0
            ? {
                relationHint: true,
                relation: relations[0],
                relations,
            }
            : {}),
        ...(analyzed.decision
            ? {
                decisionHint: true,
                decision: analyzed.decision,
            }
            : {}),
        ...(analyzed.correction
            ? {
                correctionHint: true,
                correction: analyzed.correction,
            }
            : {}),
    };
}
export function hasExplicitRememberIntent(text) {
    return detectExplicitRememberIntent(text);
}
export function buildCandidate(params) {
    const rawText = stripInjectedHistoricalBlock(params.rawText).trim();
    if (!rawText) {
        return null;
    }
    const semanticText = truncateText(rawText, params.config.captureMaxChars);
    return {
        candidateId: randomId("candidate"),
        source: {
            kind: params.sourceKind,
            ...params.source,
        },
        observedAt: params.observedAt,
        rawText: semanticText,
        eventType: params.eventType,
        structuredHints: structuredHints(rawText),
        metadata: {
            ...(params.metadata ?? {}),
            rawTextLength: rawText.length,
            semanticTextTruncated: rawText.length > semanticText.length,
        },
    };
}
export function extractFromMessageReceived(params) {
    const candidate = buildCandidate({
        sourceKind: "user",
        rawText: params.content,
        observedAt: params.observedAt,
        config: params.config,
        source: {
            messageId: typeof params.metadata?.messageId === "string" ? params.metadata.messageId : undefined,
        },
        eventType: "message_received",
        metadata: params.metadata,
    });
    return candidate ? [candidate] : [];
}
export function extractFromToolResult(params) {
    const message = params.resultMessage;
    if (!message) {
        return [];
    }
    const blocks = toTextBlocks(message.content);
    const rawText = blocks.join("\n").trim();
    if (!rawText) {
        return [];
    }
    const candidate = buildCandidate({
        sourceKind: "tool",
        rawText,
        observedAt: params.observedAt,
        config: params.config,
        source: {
            toolName: params.toolName,
            messageId: params.toolCallId,
        },
        eventType: "tool_result",
        metadata: {
            toolName: params.toolName,
            toolCallId: params.toolCallId,
            isError: Boolean(message.isError),
        },
    });
    return candidate ? [candidate] : [];
}
export function extractFromAgentEnd(params) {
    const candidates = [];
    for (const message of params.messages.slice(-12)) {
        if (!message || typeof message !== "object") {
            continue;
        }
        const entry = message;
        const role = typeof entry.role === "string" ? entry.role : "";
        if (role !== "user") {
            continue;
        }
        const text = toTextBlocks(entry.content).join("\n").trim() ||
            (typeof entry.content === "string" ? entry.content : "");
        if (!text) {
            continue;
        }
        const candidate = buildCandidate({
            sourceKind: "user",
            rawText: text,
            observedAt: params.observedAt,
            config: params.config,
            source: {
                sessionKey: params.sessionKey,
                runId: params.runId,
            },
            eventType: "agent_end_message",
            metadata: {
                role,
            },
        });
        if (candidate) {
            candidates.push(candidate);
        }
    }
    // Second pass: causal relations from assistant messages.
    // Only candidates with a caused_by or resolved_by relation hint are included
    // (minimum length threshold filters out short ack messages).
    // sourceKind "assistant" ensures shouldMaterializeObservedEvent returns false — only the
    // graph edge is written, never an episodic event, for assistant-sourced candidates.
    const CAUSAL_PREDICATES = new Set(["caused_by", "resolved_by"]);
    for (const message of params.messages.slice(-12)) {
        if (!message || typeof message !== "object") {
            continue;
        }
        const entry = message;
        const role = typeof entry.role === "string" ? entry.role : "";
        if (role !== "assistant") {
            continue;
        }
        const text = toTextBlocks(entry.content).join("\n").trim() ||
            (typeof entry.content === "string" ? entry.content : "");
        if (!text || text.length < 120) {
            continue;
        }
        const analyzed = analyzeSemanticHints(text);
        const hasCausalRelation = Boolean(analyzed.relation && CAUSAL_PREDICATES.has(analyzed.relation.predicate));
        if (!hasCausalRelation) {
            continue;
        }
        const causalCandidate = buildCandidate({
            sourceKind: "assistant",
            rawText: text,
            observedAt: params.observedAt,
            config: params.config,
            source: {
                sessionKey: params.sessionKey,
                runId: params.runId,
            },
            eventType: "agent_end_message",
            metadata: {
                role,
            },
        });
        if (causalCandidate) {
            candidates.push(causalCandidate);
        }
    }
    return candidates;
}
