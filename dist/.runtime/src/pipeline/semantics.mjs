import { normalizeText } from "../support.mjs";
import "./semantic/heuristics.mjs";
//#region src/pipeline/semantics.ts
const LEGACY_PREFERENCE_VERBS = new Set([
	"adopts",
	"configures",
	"does",
	"follows",
	"gets",
	"is",
	"likes",
	"needs",
	"sets",
	"wants"
]);
function canonicalizePreferencePredicate(value) {
	const normalized = normalizeText(value).replace(/[^\p{L}\p{N}_]+/gu, "_").replace(/^_+|_+$/g, "");
	if (!normalized) return null;
	if (normalized === "prefers_style") return "prefers_response_style";
	if (normalized === "prefers_charset") return "prefers_output_charset";
	if (normalized === "prefers") return normalized;
	const underscore = normalized.indexOf("_");
	if (underscore === -1) return LEGACY_PREFERENCE_VERBS.has(normalized) ? "prefers" : null;
	const verb = normalized.slice(0, underscore);
	const topic = normalized.slice(underscore + 1).trim();
	if (!topic) return verb === "prefers" || LEGACY_PREFERENCE_VERBS.has(verb) ? "prefers" : null;
	if (verb === "prefers") return `prefers_${topic}`;
	if (LEGACY_PREFERENCE_VERBS.has(verb)) {
		if (topic === "style") return "prefers_response_style";
		if (topic === "charset") return "prefers_output_charset";
		return `prefers_${topic}`;
	}
	return null;
}
function canonicalizePreferenceHint(hint) {
	if (!hint) return null;
	const predicate = canonicalizePreferencePredicate(hint.predicate);
	if (!predicate || !hint.object.trim()) return null;
	return {
		...hint,
		predicate,
		object: hint.object.trim(),
		reason: hint.reason?.trim() || void 0
	};
}
//#endregion
export { canonicalizePreferenceHint, canonicalizePreferencePredicate };
