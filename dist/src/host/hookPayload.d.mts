//#region src/host/hookPayload.d.ts
type MemxHostId = "openclaw" | "codex" | "claude-code" | "generic";
type MemxHostMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
};
type MemxTurnEnvelope = {
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
declare function normalizeHookPayload(hostId: string, eventName: string, payload: Record<string, unknown>): MemxTurnEnvelope;
declare function normalizeObservePayload(input: unknown): MemxTurnEnvelope;
//#endregion
export { MemxHostId, MemxHostMessage, MemxTurnEnvelope, normalizeHookPayload, normalizeObservePayload };