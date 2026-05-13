import { stripInjectedHistoricalBlock } from "../security/escaping.js";
import { randomId, truncateText } from "../support.js";
import type { MemoryCandidate, MemoryPluginConfig } from "../types.js";
import {
  hasExplicitRememberIntent as detectExplicitRememberIntent,
} from "./semantics.js";

function toTextBlocks(content: unknown): string[] {
  if (typeof content === "string") {
    return [content];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  const result: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const entry = block as Record<string, unknown>;
    if (entry.type === "text" && typeof entry.text === "string") {
      result.push(entry.text);
    }
  }
  return result;
}

function structuredHints() {
  return {
    entities: [],
    timeHints: [],
  };
}

export function hasExplicitRememberIntent(text: string): boolean {
  return detectExplicitRememberIntent(text);
}

export function buildCandidate(params: {
  sourceKind: MemoryCandidate["source"]["kind"];
  rawText: string;
  observedAt: string;
  config: MemoryPluginConfig;
  source: Partial<MemoryCandidate["source"]>;
  eventType?: string;
  metadata?: Record<string, unknown>;
}): MemoryCandidate | null {
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
    structuredHints: structuredHints(),
    metadata: {
      ...(params.metadata ?? {}),
      rawTextLength: rawText.length,
      semanticTextTruncated: rawText.length > semanticText.length,
    },
  };
}

export function extractFromMessageReceived(params: {
  content: string;
  observedAt: string;
  config: MemoryPluginConfig;
  metadata?: Record<string, unknown>;
}): MemoryCandidate[] {
  const candidate = buildCandidate({
    sourceKind: "user",
    rawText: params.content,
    observedAt: params.observedAt,
    config: params.config,
    source: {
      messageId:
        typeof params.metadata?.messageId === "string" ? params.metadata.messageId : undefined,
    },
    eventType: "message_received",
    metadata: params.metadata,
  });
  return candidate ? [candidate] : [];
}

export function extractFromToolResult(params: {
  toolName?: string;
  toolCallId?: string;
  observedAt: string;
  config: MemoryPluginConfig;
  resultMessage: unknown;
}): MemoryCandidate[] {
  const message = params.resultMessage as Record<string, unknown> | null;
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

export function extractFromAgentEnd(params: {
  messages: unknown[];
  observedAt: string;
  config: MemoryPluginConfig;
  sessionKey?: string;
  runId?: string;
}): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  for (const message of params.messages.slice(-12)) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const entry = message as Record<string, unknown>;
    const role = typeof entry.role === "string" ? entry.role : "";
    if (role !== "user") {
      continue;
    }
    const text =
      toTextBlocks(entry.content).join("\n").trim() ||
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

  return candidates;
}
