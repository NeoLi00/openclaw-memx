import { normalizeHookPayload, type MemxHostId } from "./hookPayload.js";

const DEFAULT_URL = "http://127.0.0.1:3878";
const CONTEXT_INJECTION_EVENTS = new Set(["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"]);

async function readStdinJson(): Promise<Record<string, unknown>> {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  if (!input.trim()) {
    return {};
  }
  return JSON.parse(input) as Record<string, unknown>;
}

function authHeaders(): Record<string, string> {
  const secret = process.env["MEMX_SECRET"];
  return secret ? { authorization: `Bearer ${secret}` } : {};
}

async function post(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const url = (process.env["MEMX_URL"] || DEFAULT_URL).replace(/\/+$/u, "");
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hookCanInjectContext(host: MemxHostId, eventName: string): boolean {
  return (host === "codex" || host === "claude-code") && CONTEXT_INJECTION_EVENTS.has(eventName);
}

function userQueryFromEnvelope(envelope: ReturnType<typeof normalizeHookPayload>): string | null {
  const userMessage = envelope.messages.find((message) => message.role === "user" && message.content.trim());
  return userMessage?.content.trim() || null;
}

function contextRequestFromEnvelope(envelope: ReturnType<typeof normalizeHookPayload>): Record<string, unknown> | null {
  const query = userQueryFromEnvelope(envelope);
  if (!query) {
    return null;
  }
  return {
    query,
    hostId: envelope.hostId,
    actorId: envelope.actorId,
    sessionId: envelope.sessionId,
    workspaceDir: envelope.workspaceDir,
    project: envelope.project,
    limit: 6,
  };
}

function recalledContext(response: unknown): string | null {
  if (!isRecord(response)) {
    return null;
  }
  const value = response.prependContext ?? response.context;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function writeAdditionalContext(eventName: string, additionalContext: string): void {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: eventName,
        additionalContext,
      },
    })}\n`,
  );
}

export async function runMemxHook(argv = process.argv.slice(2)): Promise<void> {
  const host = (argv[0] || process.env["MEMX_HOOK_HOST"] || "generic") as MemxHostId;
  const eventName = argv[1] || process.env["MEMX_HOOK_EVENT"] || "observe";
  const payload = await readStdinJson();
  const timeoutMs = Number(process.env["MEMX_HOOK_TIMEOUT_MS"] || 3000);
  try {
    const envelope = normalizeHookPayload(host, eventName, payload);
    const requestTimeoutMs = Number.isFinite(timeoutMs) ? timeoutMs : 3000;
    const startedAt = Date.now();
    const remainingTimeoutMs = () => Math.max(250, requestTimeoutMs - (Date.now() - startedAt));
    const contextRequest = hookCanInjectContext(envelope.hostId, eventName)
      ? contextRequestFromEnvelope(envelope)
      : null;
    if (!contextRequest) {
      await post("/v1/observe", envelope, requestTimeoutMs);
      return;
    }

    // Recall must read the previous memory epoch. If observe runs first, the current prompt
    // can be persisted quickly enough to be injected back into itself as "memory".
    const contextResult = await Promise.resolve()
      .then(() => post("/v1/context", contextRequest, remainingTimeoutMs()))
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      );
    if (contextResult.status === "fulfilled") {
      const context = recalledContext(contextResult.value);
      if (context) {
        writeAdditionalContext(eventName, context);
      }
    } else if (process.env["MEMX_HOOK_DEBUG"] === "1") {
      console.error(
        `memx hook recall failed: ${
          contextResult.reason instanceof Error ? contextResult.reason.message : String(contextResult.reason)
        }`,
      );
    }

    const observeResult = await Promise.resolve()
      .then(() => post("/v1/observe", envelope, remainingTimeoutMs()))
      .then(
        () => ({ status: "fulfilled" as const }),
        (reason) => ({ status: "rejected" as const, reason }),
      );
    if (observeResult.status === "rejected" && process.env["MEMX_HOOK_DEBUG"] === "1") {
      console.error(
        `memx hook observe failed: ${
          observeResult.reason instanceof Error ? observeResult.reason.message : String(observeResult.reason)
        }`,
      );
    }
  } catch (error) {
    if (process.env["MEMX_HOOK_DEBUG"] === "1") {
      console.error(`memx hook failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
