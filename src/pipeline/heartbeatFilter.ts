import { readMessageText } from "./messageText.js";

const HEARTBEAT_PROVIDER = "heartbeat";
const CRON_EVENT_PROVIDER = "cron-event";
const EXEC_EVENT_PROVIDER = "exec-event";
const HEARTBEAT_TOKEN = "HEARTBEAT_OK";
const HEARTBEAT_TOKEN_LOWER = HEARTBEAT_TOKEN.toLowerCase();

type HeartbeatHookContext = {
  sessionKey?: string;
  messageProvider?: string;
  trigger?: string;
};

type HeartbeatHookEvent = {
  prompt?: string;
  messages?: unknown[];
};

function normalizedValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
}

function isAsciiWordChar(char: string | undefined): boolean {
  if (!char) {
    return false;
  }
  const code = char.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    char === "_"
  );
}

function unwrapLightMarkup(text: string): string {
  let trimmed = text.trim();
  if (trimmed.startsWith("<b>") && trimmed.endsWith("</b>")) {
    trimmed = trimmed.slice(3, -4).trim();
  }
  if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
    trimmed = trimmed.slice(2, -2).trim();
  }
  return trimmed;
}

export function isHeartbeatAckText(text: string): boolean {
  const lower = unwrapLightMarkup(text).trim().toLowerCase();
  if (!lower.startsWith(HEARTBEAT_TOKEN_LOWER)) {
    return false;
  }
  const suffix = lower.slice(HEARTBEAT_TOKEN_LOWER.length);
  return suffix.length === 0 || !isAsciiWordChar(suffix[0]);
}

export function isHeartbeatControlText(text: string): boolean {
  const lower = unwrapLightMarkup(text).trim().toLowerCase();
  if (!lower) {
    return false;
  }
  return (
    isHeartbeatAckText(lower) ||
    lower.startsWith("heartbeat poll:") ||
    lower.startsWith("heartbeat wake:")
  );
}

function isPureHeartbeatProvider(provider: string | undefined): boolean {
  return provider === HEARTBEAT_PROVIDER;
}

function isNonHeartbeatSystemEventProvider(provider: string | undefined): boolean {
  return provider === CRON_EVENT_PROVIDER || provider === EXEC_EVENT_PROVIDER;
}

function isIsolatedHeartbeatSession(sessionKey: string | undefined): boolean {
  return Boolean(sessionKey?.trim().toLowerCase().endsWith(":heartbeat"));
}

function eventTexts(event: HeartbeatHookEvent | undefined): string[] {
  const texts: string[] = [];
  if (typeof event?.prompt === "string") {
    texts.push(event.prompt);
  }
  if (Array.isArray(event?.messages)) {
    for (const message of event.messages) {
      if (!message || typeof message !== "object") {
        continue;
      }
      const record = message as Record<string, unknown>;
      const text = readMessageText(record.content);
      if (text.trim()) {
        texts.push(text);
      }
    }
  }
  return texts;
}

function hasHeartbeatPromptShape(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return (
    lower.includes(HEARTBEAT_TOKEN_LOWER) &&
    (lower.includes("heartbeat.md") || lower.includes("nothing needs attention"))
  );
}

export function shouldSkipMemxForHeartbeat(
  event: HeartbeatHookEvent | undefined,
  ctx: HeartbeatHookContext,
): boolean {
  const provider = normalizedValue(ctx.messageProvider);
  if (isPureHeartbeatProvider(provider)) {
    return true;
  }
  if (isNonHeartbeatSystemEventProvider(provider)) {
    return false;
  }

  const texts = eventTexts(event);
  if (texts.some(isHeartbeatControlText)) {
    return true;
  }

  const trigger = normalizedValue(ctx.trigger);
  if (trigger !== HEARTBEAT_PROVIDER) {
    return false;
  }
  if (isIsolatedHeartbeatSession(ctx.sessionKey)) {
    return true;
  }
  return texts.some(hasHeartbeatPromptShape);
}
