import { Type } from "@sinclair/typebox";
//#region src/tooling.ts
function stringEnum(values, description) {
	return Type.Unsafe({
		type: "string",
		enum: [...values],
		...description ? { description } : {}
	});
}
function jsonToolResult(payload) {
	return {
		content: [{
			type: "text",
			text: JSON.stringify(payload, null, 2)
		}],
		details: payload
	};
}
function readString(params, key) {
	const value = params[key];
	return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function readNumber(params, key) {
	const value = params[key];
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : void 0;
	}
}
function readBoolean(params, key) {
	const value = params[key];
	return typeof value === "boolean" ? value : void 0;
}
//#endregion
export { jsonToolResult, readBoolean, readNumber, readString, stringEnum };
