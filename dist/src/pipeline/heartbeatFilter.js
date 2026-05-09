import { readMessageText } from "./messageText.js";
const HEARTBEAT_PROVIDER = "heartbeat";
const CRON_EVENT_PROVIDER = "cron-event";
const EXEC_EVENT_PROVIDER = "exec-event";
const HEARTBEAT_TOKEN = "HEARTBEAT_OK";
const HEARTBEAT_TOKEN_LOWER = HEARTBEAT_TOKEN.toLowerCase();
function normalizedValue(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const normalized = value.trim().toLowerCase();
    return normalized || undefined;
}
function isAsciiWordChar(char) {
    if (!char) {
        return false;
    }
    const code = char.charCodeAt(0);
    return ((code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        char === "_");
}
function unwrapLightMarkup(text) {
    let trimmed = text.trim();
    if (trimmed.startsWith("<b>") && trimmed.endsWith("</b>")) {
        trimmed = trimmed.slice(3, -4).trim();
    }
    if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
        trimmed = trimmed.slice(2, -2).trim();
    }
    return trimmed;
}
export function isHeartbeatAckText(text) {
    const lower = unwrapLightMarkup(text).trim().toLowerCase();
    if (!lower.startsWith(HEARTBEAT_TOKEN_LOWER)) {
        return false;
    }
    const suffix = lower.slice(HEARTBEAT_TOKEN_LOWER.length);
    return suffix.length === 0 || !isAsciiWordChar(suffix[0]);
}
export function isHeartbeatControlText(text) {
    const lower = unwrapLightMarkup(text).trim().toLowerCase();
    if (!lower) {
        return false;
    }
    return (isHeartbeatAckText(lower) ||
        lower.startsWith("heartbeat poll:") ||
        lower.startsWith("heartbeat wake:"));
}
function isPureHeartbeatProvider(provider) {
    return provider === HEARTBEAT_PROVIDER;
}
function isNonHeartbeatSystemEventProvider(provider) {
    return provider === CRON_EVENT_PROVIDER || provider === EXEC_EVENT_PROVIDER;
}
function isIsolatedHeartbeatSession(sessionKey) {
    return Boolean(sessionKey?.trim().toLowerCase().endsWith(":heartbeat"));
}
function eventTexts(event) {
    const texts = [];
    if (typeof event?.prompt === "string") {
        texts.push(event.prompt);
    }
    if (Array.isArray(event?.messages)) {
        for (const message of event.messages) {
            if (!message || typeof message !== "object") {
                continue;
            }
            const record = message;
            const text = readMessageText(record.content);
            if (text.trim()) {
                texts.push(text);
            }
        }
    }
    return texts;
}
function hasHeartbeatPromptShape(text) {
    const lower = text.trim().toLowerCase();
    return (lower.includes(HEARTBEAT_TOKEN_LOWER) &&
        (lower.includes("heartbeat.md") || lower.includes("nothing needs attention")));
}
export function shouldSkipMemxForHeartbeat(event, ctx) {
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
