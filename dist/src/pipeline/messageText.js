const META_SENTINELS = [
    "Conversation info (untrusted metadata):",
    "Sender (untrusted metadata):",
    "Thread starter (untrusted, for context):",
    "Replied message (untrusted, for context):",
    "Forwarded message context (untrusted metadata):",
    "Chat history since last reply (untrusted, for context):",
];
const META_FAST_RE = new RegExp(META_SENTINELS.map((entry) => entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
const ENVELOPE_PREFIX_RE = /^\s*\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+[A-Z]{3}[+-]\d{1,2}\]\s*/;
export function readMessageText(content) {
    if (typeof content === "string") {
        return content;
    }
    if (!Array.isArray(content)) {
        return "";
    }
    const parts = [];
    for (const block of content) {
        if (!block || typeof block !== "object") {
            continue;
        }
        const record = block;
        if (record.type === "text" && typeof record.text === "string") {
            parts.push(record.text);
        }
        else if (typeof record.text === "string") {
            parts.push(record.text);
        }
        else if (typeof record.content === "string") {
            parts.push(record.content);
        }
    }
    return parts.join("\n");
}
export function stripEnvelopePrefix(text) {
    return text.replace(ENVELOPE_PREFIX_RE, "");
}
export function stripInboundMetadata(text) {
    let cleaned = stripEnvelopePrefix(text)
        .replace(/\[message_id:\s*[a-f0-9-]+\]/gi, "")
        .replace(/\[\[reply_to_current\]\]/gi, "")
        .trim();
    if (!META_FAST_RE.test(cleaned)) {
        return cleaned;
    }
    const lines = cleaned.split("\n");
    const result = [];
    let inMeta = false;
    let inFence = false;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const trimmed = line.trim();
        if (!inMeta && META_SENTINELS.includes(trimmed)) {
            if ((lines[index + 1] ?? "").trim() === "```json") {
                inMeta = true;
                continue;
            }
            continue;
        }
        if (inMeta) {
            if (!inFence && trimmed === "```json") {
                inFence = true;
                continue;
            }
            if (inFence && trimmed === "```") {
                inMeta = false;
                inFence = false;
            }
            continue;
        }
        result.push(line);
    }
    return stripEnvelopePrefix(result.join("\n")).trim();
}
