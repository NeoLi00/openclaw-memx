import { Type } from "@sinclair/typebox";
export function stringEnum(values, description) {
    return Type.Unsafe({
        type: "string",
        enum: [...values],
        ...(description ? { description } : {}),
    });
}
export function jsonToolResult(payload) {
    return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        details: payload,
    };
}
export function readString(params, key) {
    const value = params[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
export function readNumber(params, key) {
    const value = params[key];
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}
export function readBoolean(params, key) {
    const value = params[key];
    return typeof value === "boolean" ? value : undefined;
}
