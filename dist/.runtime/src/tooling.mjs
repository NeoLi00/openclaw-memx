//#region src/tooling.ts
const OPTIONAL_MARKER = "__memxOptional";
const Type = {
	String() {
		return { type: "string" };
	},
	Number() {
		return { type: "number" };
	},
	Boolean() {
		return { type: "boolean" };
	},
	Optional(schema) {
		return {
			...schema,
			[OPTIONAL_MARKER]: true
		};
	},
	Object(properties) {
		const cleanProperties = Object.fromEntries(Object.entries(properties).map(([key, schema]) => {
			const { [OPTIONAL_MARKER]: _optional, ...cleanSchema } = schema;
			return [key, cleanSchema];
		}));
		const required = Object.entries(properties).filter(([, schema]) => schema[OPTIONAL_MARKER] !== true).map(([key]) => key);
		return {
			type: "object",
			properties: cleanProperties,
			...required.length > 0 ? { required } : {},
			additionalProperties: false
		};
	}
};
function stringEnum(values, description) {
	return {
		type: "string",
		enum: [...values],
		...description ? { description } : {}
	};
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
export { Type, jsonToolResult, readBoolean, readNumber, readString, stringEnum };
