import { randomId, truncateText } from "../support.mjs";
import "./semantic/heuristics.mjs";
import "./semantics.mjs";
import { stripInjectedHistoricalBlock } from "../security/escaping.mjs";
function structuredHints() {
	return {
		entities: [],
		timeHints: []
	};
}
function buildCandidate(params) {
	const rawText = stripInjectedHistoricalBlock(params.rawText).trim();
	if (!rawText) return null;
	const semanticText = truncateText(rawText, params.config.captureMaxChars);
	return {
		candidateId: randomId("candidate"),
		source: {
			kind: params.sourceKind,
			...params.source
		},
		observedAt: params.observedAt,
		rawText: semanticText,
		eventType: params.eventType,
		structuredHints: structuredHints(),
		metadata: {
			...params.metadata ?? {},
			rawTextLength: rawText.length,
			semanticTextTruncated: rawText.length > semanticText.length
		}
	};
}
//#endregion
export { buildCandidate };
