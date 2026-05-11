export type AgentEndCursorStore = {
  getSessionCursor(agentId: string, sessionKey: string): number | undefined;
  setSessionCursor(agentId: string, sessionKey: string, cursor: number): void;
};

export type AgentEndContext = {
  trigger?: string;
  messageProvider?: string;
};

export function isTurnScopedAgentEndPayload(ctx: AgentEndContext): boolean {
  return ctx.trigger === "memory" && ctx.messageProvider === "gateway";
}

function initializeSnapshotCursor(messages: unknown[]): number {
  const roles = messages
    .filter(
      (message): message is Record<string, unknown> =>
        Boolean(message) && typeof message === "object",
    )
    .map((message) => message.role)
    .filter((role): role is string => typeof role === "string");
  if (roles.length > 0 && roles.every((role) => role === "user")) {
    return 0;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message &&
      typeof message === "object" &&
      (message as Record<string, unknown>).role === "user"
    ) {
      return index;
    }
  }
  return messages.length;
}

export function selectAgentEndMessagesForCapture(params: {
  messages: unknown[];
  ctx: AgentEndContext;
  cursors: AgentEndCursorStore;
  agentId: string;
  sessionKey: string;
}): unknown[] {
  if (isTurnScopedAgentEndPayload(params.ctx)) {
    return params.messages;
  }

  let cursor = params.cursors.getSessionCursor(params.agentId, params.sessionKey);
  if (cursor === undefined) {
    cursor = initializeSnapshotCursor(params.messages);
  }
  if (cursor > params.messages.length) {
    cursor = 0;
  }
  params.cursors.setSessionCursor(params.agentId, params.sessionKey, params.messages.length);
  if (cursor >= params.messages.length) {
    return [];
  }
  return params.messages.slice(cursor);
}
