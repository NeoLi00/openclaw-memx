import { truncateText } from "../support.js";

export type MemxHostId = "openclaw" | "codex" | "claude-code" | "generic";

export type MemxHostMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
};

export type MemxTurnEnvelope = {
  hostId: MemxHostId;
  actorId: string;
  sessionId: string;
  workspaceDir?: string;
  project?: string;
  runId?: string;
  eventName: string;
  observedAt: string;
  messages: MemxHostMessage[];
  metadata?: Record<string, unknown>;
};

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeHostId(hostId: string): MemxHostId {
  const normalized = hostId.toLowerCase().replace(/_/g, "-");
  if (normalized === "codex" || normalized === "claude-code" || normalized === "openclaw") {
    return normalized;
  }
  return "generic";
}

function compactJson(value: unknown, maxChars = 1800): string {
  if (typeof value === "string") {
    return truncateText(value, maxChars);
  }
  try {
    return truncateText(JSON.stringify(value), maxChars);
  } catch {
    return truncateText(String(value), maxChars);
  }
}

function hookToolName(payload: Record<string, unknown>): string | undefined {
  return readString(payload, ["tool_name", "toolName", "name", "matcher"]);
}

function hookToolMessage(eventName: string, payload: Record<string, unknown>): MemxHostMessage {
  const toolName = hookToolName(payload) ?? eventName;
  const parts = [
    `hook=${eventName}`,
    `tool=${toolName}`,
    payload.tool_input !== undefined ? `input=${compactJson(payload.tool_input)}` : "",
    payload.tool_response !== undefined ? `response=${compactJson(payload.tool_response)}` : "",
    payload.error !== undefined ? `error=${compactJson(payload.error)}` : "",
  ].filter(Boolean);
  return {
    role: "tool",
    toolName,
    content: parts.join("\n"),
  };
}

function canCaptureToolEvents(): boolean {
  return process.env["MEMX_CAPTURE_TOOL_EVENTS"] === "1";
}

function messagesFromHook(eventName: string, payload: Record<string, unknown>): MemxHostMessage[] {
  const prompt = readString(payload, ["prompt", "user_prompt", "userPrompt"]);
  if (eventName === "UserPromptSubmit" && prompt) {
    return [{ role: "user", content: prompt }];
  }
  const assistant = readString(payload, ["assistant_response", "assistantResponse", "response"]);
  if (eventName === "Stop" && assistant) {
    return [{ role: "assistant", content: assistant }];
  }
  if (
    eventName === "PreToolUse" ||
    eventName === "PostToolUse" ||
    eventName === "PostToolUseFailure" ||
    eventName === "PreCompact" ||
    eventName === "PostCompact" ||
    eventName === "SubagentStart" ||
    eventName === "SubagentStop" ||
    eventName === "Notification" ||
    eventName === "TaskCompleted" ||
    eventName === "SessionStart" ||
    eventName === "SessionEnd"
  ) {
    return canCaptureToolEvents() ? [hookToolMessage(eventName, payload)] : [];
  }
  if (prompt) {
    return [{ role: "user", content: prompt }];
  }
  return canCaptureToolEvents() ? [hookToolMessage(eventName, payload)] : [];
}

export function normalizeHookPayload(
  hostId: string,
  eventName: string,
  payload: Record<string, unknown>,
): MemxTurnEnvelope {
  const normalizedHost = normalizeHostId(hostId);
  const sessionId =
    readString(payload, ["session_id", "sessionId", "conversation_id", "conversationId"]) ??
    `${normalizedHost}-default`;
  const workspaceDir =
    readString(payload, ["cwd", "workspaceDir", "workspace_dir", "project_dir"]) ??
    process.cwd();
  const actorId =
    readString(payload, ["actor_id", "actorId", "agent_id", "agentId"]) ??
    process.env["MEMX_ACTOR_ID"] ??
    "memx-shared";
  const observedAt = readString(payload, ["timestamp", "observedAt"]) ?? new Date().toISOString();
  return {
    hostId: normalizedHost,
    actorId,
    sessionId,
    workspaceDir,
    project: readString(payload, ["project", "projectName"]),
    runId: readString(payload, ["run_id", "runId"]),
    eventName,
    observedAt,
    messages: messagesFromHook(eventName, payload),
    metadata: {
      rawHookEvent: eventName,
      transcriptPath: readString(payload, ["transcript_path", "transcriptPath"]),
    },
  };
}

export function normalizeObservePayload(input: unknown): MemxTurnEnvelope {
  if (!input || typeof input !== "object") {
    throw new Error("observe payload must be an object");
  }
  const record = input as Record<string, unknown>;
  if (Array.isArray(record.messages)) {
    return {
      hostId: normalizeHostId(readString(record, ["hostId", "host"]) ?? "generic"),
      actorId: readString(record, ["actorId", "agentId"]) ?? "memx-shared",
      sessionId: readString(record, ["sessionId", "sessionKey"]) ?? "generic-default",
      workspaceDir: readString(record, ["workspaceDir", "cwd"]) ?? process.cwd(),
      project: readString(record, ["project"]),
      runId: readString(record, ["runId"]),
      eventName: readString(record, ["eventName"]) ?? "observe",
      observedAt: readString(record, ["observedAt", "timestamp"]) ?? new Date().toISOString(),
      messages: record.messages
        .filter((message): message is Record<string, unknown> =>
          Boolean(message && typeof message === "object"),
        )
        .map((message): MemxHostMessage => ({
          role:
            message.role === "assistant" || message.role === "tool" || message.role === "user"
              ? message.role
              : "user",
          content: readString(message, ["content", "text"]) ?? "",
          toolName: readString(message, ["toolName", "name"]),
        }))
        .filter((message) => message.content.trim().length > 0),
      metadata:
        record.metadata && typeof record.metadata === "object"
          ? (record.metadata as Record<string, unknown>)
          : undefined,
    };
  }
  return normalizeHookPayload(
    readString(record, ["hostId", "host"]) ?? "generic",
    readString(record, ["eventName", "hookType"]) ?? "observe",
    record,
  );
}
