import { randomId, truncateText } from "../support.mjs";
import { extractTimeHints, inferEntityNames } from "./semantic/heuristics.mjs";
import { analyzeSemanticHints } from "./semantics.mjs";
import { stripInjectedHistoricalBlock } from "../security/escaping.mjs";
function structuredHints(text) {
	const analyzed = analyzeSemanticHints(text);
	const workflows = analyzed.workflows;
	const relations = analyzed.relations.length > 0 ? analyzed.relations : analyzed.relation ? [analyzed.relation] : [];
	return {
		entities: analyzed.entities.length > 0 ? analyzed.entities : inferEntityNames(text),
		timeHints: analyzed.timeHints.length > 0 ? analyzed.timeHints : extractTimeHints(text),
		...analyzed.preference ? {
			preferenceHint: true,
			preference: analyzed.preference
		} : {},
		...workflows.length > 0 ? {
			taskStateHint: true,
			workflow: workflows[0],
			workflows
		} : {},
		...relations.length > 0 ? {
			relationHint: true,
			relation: relations[0],
			relations
		} : {},
		...analyzed.decision ? {
			decisionHint: true,
			decision: analyzed.decision
		} : {},
		...analyzed.correction ? {
			correctionHint: true,
			correction: analyzed.correction
		} : {}
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
		structuredHints: structuredHints(rawText),
		metadata: {
			...params.metadata ?? {},
			rawTextLength: rawText.length,
			semanticTextTruncated: rawText.length > semanticText.length
		}
	};
}
//#endregion
export { buildCandidate };
