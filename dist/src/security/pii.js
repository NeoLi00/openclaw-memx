const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_REGEX = /\b(?:\+?\d[\d(). -]{7,}\d)\b/;
const TOKEN_REGEX = /\b(?:sk-[a-z0-9][a-z0-9_-]{7,}|gh[pus]_[a-z0-9_-]{12,}|xox[baprs]-[a-z0-9-]{10,}|Bearer\s+[a-z0-9._-]{12,})\b/i;
const SECRET_ASSIGNMENT_REGEX = /\b(?:password|passwd|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*\S+/i;
const SECRET_VALUE_CONTEXT_REGEX = /\b(?:token|api[_-]?key|access[_-]?token|secret|credential)\b.{0,12}\b[a-z0-9._-]{10,}\b/i;
export function redactSensitiveText(text, piiMode) {
    if (piiMode === "allow") {
        return text;
    }
    if (piiMode === "off") {
        return text;
    }
    return text
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
        .replace(/\b(?:sk-[a-z0-9][a-z0-9_-]{7,}|gh[pus]_[a-z0-9_-]{12,}|xox[baprs]-[a-z0-9-]{10,}|Bearer\s+[a-z0-9._-]{12,})\b/gi, "[redacted-token]")
        .replace(/\b(?:\+?\d[\d(). -]{7,}\d)\b/g, "[redacted-phone]")
        .replace(/\b(?:password|passwd|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*\S+/gi, "[redacted-secret]");
}
export function containsSensitiveValue(text) {
    return (EMAIL_REGEX.test(text) ||
        PHONE_REGEX.test(text) ||
        TOKEN_REGEX.test(text) ||
        SECRET_ASSIGNMENT_REGEX.test(text) ||
        SECRET_VALUE_CONTEXT_REGEX.test(text));
}
export function sensitivityScore(text) {
    let score = 0;
    if (EMAIL_REGEX.test(text)) {
        score += 0.35;
    }
    if (PHONE_REGEX.test(text)) {
        score += 0.35;
    }
    if (TOKEN_REGEX.test(text)) {
        score += 0.75;
    }
    if (SECRET_ASSIGNMENT_REGEX.test(text)) {
        score += 0.75;
    }
    if (SECRET_VALUE_CONTEXT_REGEX.test(text)) {
        score += 0.7;
    }
    return Math.min(1, score);
}
