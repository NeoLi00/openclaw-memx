import { stableHash, truncateText } from "../support.mjs";
import { recordMemoryLlmBudgetCall } from "./llmBudgetAudit.mjs";
//#region src/pipeline/turnSemanticCompiler.ts
const TURN_MESSAGE_ENVELOPE_LONG_THRESHOLD_CHARS = 1800;
const TURN_MESSAGE_ENVELOPE_HEAD_CHARS = 650;
const TURN_MESSAGE_ENVELOPE_TAIL_CHARS = 950;
const TURN_MESSAGE_ENVELOPE_LATEST_INSTRUCTION_CHARS = 900;
const RECENT_REFERENCE_CONTEXT_MAX_TURNS = 2;
const RECENT_REFERENCE_CONTEXT_MAX_MESSAGES_PER_TURN = 4;
const RECENT_REFERENCE_CONTEXT_SUMMARY_CHARS = 160;
const RECENT_REFERENCE_CONTEXT_TEXT_CHARS = 360;
const LONG_TURN_SCAN_MAX_SEGMENTS_PER_MESSAGE = 8;
const LONG_TURN_SCAN_SEGMENT_PROMPT_CHARS = 1800;
function sourceRefForMessage(message) {
	return message.sourceRef || `${message.role}:${message.turnId}`;
}
function clampMessageWindow(content, start, end) {
	const safeStart = Math.max(0, Math.min(content.length, start));
	const safeEnd = Math.max(safeStart, Math.min(content.length, end));
	const text = content.slice(safeStart, safeEnd).trim();
	if (!text) return null;
	return {
		kind: "full",
		start: safeStart,
		end: safeEnd,
		text
	};
}
function latestInstructionWindow(content) {
	const trimmedEnd = content.trimEnd().length;
	if (trimmedEnd <= 0) return null;
	const prefix = content.slice(0, trimmedEnd);
	const lastParagraphBreak = Math.max(prefix.lastIndexOf("\n\n"), prefix.lastIndexOf("\r\n\r\n"));
	const paragraphStart = lastParagraphBreak >= 0 ? lastParagraphBreak + 2 : 0;
	const window = clampMessageWindow(content, Math.max(paragraphStart, trimmedEnd - TURN_MESSAGE_ENVELOPE_LATEST_INSTRUCTION_CHARS), trimmedEnd);
	return window ? {
		...window,
		kind: "latest_instruction"
	} : null;
}
function mergedVisibleChars(windows) {
	const intervals = windows.map((window) => ({
		start: window.start,
		end: window.end
	})).filter((interval) => interval.end > interval.start).sort((left, right) => left.start - right.start);
	let visible = 0;
	let cursorStart;
	let cursorEnd;
	for (const interval of intervals) {
		if (cursorStart === void 0 || cursorEnd === void 0) {
			cursorStart = interval.start;
			cursorEnd = interval.end;
			continue;
		}
		if (interval.start <= cursorEnd) {
			cursorEnd = Math.max(cursorEnd, interval.end);
			continue;
		}
		visible += cursorEnd - cursorStart;
		cursorStart = interval.start;
		cursorEnd = interval.end;
	}
	if (cursorStart !== void 0 && cursorEnd !== void 0) visible += cursorEnd - cursorStart;
	return visible;
}
function uniqueMessageWindows(windows) {
	const seen = /* @__PURE__ */ new Set();
	const unique = [];
	for (const window of windows) {
		const key = `${window.kind}:${window.start}:${window.end}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(window);
	}
	return unique;
}
function buildMessageEnvelope(message) {
	const rawLength = message.content.length;
	const rawHash = stableHash([
		"turn-message-envelope",
		sourceRefForMessage(message),
		message.content
	]);
	const sourceRef = sourceRefForMessage(message);
	if (rawLength <= TURN_MESSAGE_ENVELOPE_LONG_THRESHOLD_CHARS) {
		const full = clampMessageWindow(message.content, 0, rawLength);
		const windows = full ? [{
			...full,
			kind: "full"
		}] : [];
		const visibleChars = mergedVisibleChars(windows);
		return {
			role: message.role,
			sourceRef,
			turnId: message.turnId,
			rawLength,
			rawHash,
			truncated: false,
			visibleChars,
			omittedChars: Math.max(0, rawLength - visibleChars),
			windows
		};
	}
	const head = clampMessageWindow(message.content, 0, TURN_MESSAGE_ENVELOPE_HEAD_CHARS);
	const tail = clampMessageWindow(message.content, rawLength - TURN_MESSAGE_ENVELOPE_TAIL_CHARS, rawLength);
	const latest = latestInstructionWindow(message.content);
	const windows = uniqueMessageWindows([
		head ? {
			...head,
			kind: "head"
		} : null,
		tail ? {
			...tail,
			kind: "tail"
		} : null,
		latest
	].filter((window) => Boolean(window)));
	const visibleChars = mergedVisibleChars(windows);
	return {
		role: message.role,
		sourceRef,
		turnId: message.turnId,
		rawLength,
		rawHash,
		truncated: true,
		visibleChars,
		omittedChars: Math.max(0, rawLength - visibleChars),
		windows
	};
}
function buildTurnSemanticCompilerInput(messages, referenceContext) {
	return {
		messages: messages.map((message) => buildMessageEnvelope(message)),
		...referenceContext ? { recentReferenceContext: referenceContext } : {}
	};
}
function compactReferenceText(value, limit) {
	const compact = value.replace(/\s+/g, " ").trim();
	return compact ? truncateText(compact, limit) : void 0;
}
function chunkTimestamp(chunk) {
	const updated = Date.parse(chunk.updatedAt);
	if (Number.isFinite(updated)) return updated;
	const created = Date.parse(chunk.createdAt);
	return Number.isFinite(created) ? created : 0;
}
function referenceMessageForChunk(chunk) {
	const summary = compactReferenceText(chunk.summary, RECENT_REFERENCE_CONTEXT_SUMMARY_CHARS);
	const textExcerpt = compactReferenceText(chunk.content, RECENT_REFERENCE_CONTEXT_TEXT_CHARS);
	if (!summary && !textExcerpt) return null;
	return {
		role: chunk.role,
		turnId: chunk.turnId,
		sourceRef: chunk.sourceRef || `${chunk.role}:${chunk.turnId}:${chunk.seq}`,
		...summary ? { summary } : {},
		...textExcerpt ? { textExcerpt } : {}
	};
}
function buildRecentReferenceContext(params) {
	const currentTurnIds = new Set(params.messages.map((message) => message.turnId));
	const seenChunks = /* @__PURE__ */ new Set();
	const chunks = [...params.activeChunks ?? [], ...Object.values(params.recentChunksByTask ?? {}).flat()].filter((chunk) => {
		if (!chunk.turnId || currentTurnIds.has(chunk.turnId)) return false;
		const key = chunk.chunkId || chunk.sourceRef || `${chunk.turnId}:${chunk.seq}:${chunk.role}`;
		if (seenChunks.has(key)) return false;
		seenChunks.add(key);
		return chunk.dedupStatus === "active";
	}).sort((left, right) => {
		const timeDelta = chunkTimestamp(left) - chunkTimestamp(right);
		return timeDelta !== 0 ? timeDelta : left.seq - right.seq;
	});
	const byTurn = /* @__PURE__ */ new Map();
	const turnTimestamps = /* @__PURE__ */ new Map();
	for (const chunk of chunks) {
		const group = byTurn.get(chunk.turnId) ?? [];
		group.push(chunk);
		byTurn.set(chunk.turnId, group);
		turnTimestamps.set(chunk.turnId, Math.max(turnTimestamps.get(chunk.turnId) ?? 0, chunkTimestamp(chunk)));
	}
	const turns = [...byTurn.entries()].sort(([leftTurnId], [rightTurnId]) => (turnTimestamps.get(leftTurnId) ?? 0) - (turnTimestamps.get(rightTurnId) ?? 0)).slice(-RECENT_REFERENCE_CONTEXT_MAX_TURNS).map(([turnId, turnChunks]) => ({
		turnId,
		messages: turnChunks.sort((left, right) => left.seq - right.seq).slice(0, RECENT_REFERENCE_CONTEXT_MAX_MESSAGES_PER_TURN).map((chunk) => referenceMessageForChunk(chunk)).filter((entry) => Boolean(entry))
	})).filter((turn) => turn.messages.length > 0);
	if (turns.length === 0) return;
	return {
		purpose: "deictic_reference_resolution",
		maxTurns: RECENT_REFERENCE_CONTEXT_MAX_TURNS,
		turns
	};
}
function selectedSegmentIndexes(segmentCount, maxSegments) {
	if (segmentCount <= maxSegments) return Array.from({ length: segmentCount }, (_, index) => index);
	const selected = new Set([0, segmentCount - 1]);
	for (let slot = 1; slot < maxSegments - 1; slot += 1) {
		const index = Math.round(slot * (segmentCount - 1) / (maxSegments - 1));
		selected.add(index);
	}
	return [...selected].sort((left, right) => left - right);
}
function buildLongTurnSemanticScanInputFromSegments(segments, recentReferenceContext) {
	const bySourceRef = /* @__PURE__ */ new Map();
	for (const segment of segments) {
		const group = bySourceRef.get(segment.parentSourceRef) ?? [];
		group.push(segment);
		bySourceRef.set(segment.parentSourceRef, group);
	}
	const messages = [];
	for (const [sourceRef, group] of bySourceRef) {
		const ordered = [...group].sort((left, right) => left.segmentIndex - right.segmentIndex);
		const indexes = new Set(selectedSegmentIndexes(ordered.length, LONG_TURN_SCAN_MAX_SEGMENTS_PER_MESSAGE));
		const selected = ordered.filter((segment, index) => indexes.has(index));
		const first = ordered[0];
		const rawLength = Math.max(...ordered.map((segment) => segment.charEnd));
		messages.push({
			role: first.role,
			sourceRef,
			turnId: first.turnId,
			rawLength,
			rawHash: stableHash([
				"long-turn-source-segments",
				sourceRef,
				...ordered.map((segment) => segment.contentHash)
			]),
			segmentCount: ordered.length,
			selectedSegmentCount: selected.length,
			omittedSegmentCount: Math.max(0, ordered.length - selected.length),
			segments: selected.map((segment) => {
				const text = truncateText(segment.text, LONG_TURN_SCAN_SEGMENT_PROMPT_CHARS);
				return {
					index: segment.segmentIndex,
					start: segment.charStart,
					end: segment.charEnd,
					text,
					truncated: text.length < segment.text.length
				};
			})
		});
	}
	return {
		messages,
		...recentReferenceContext ? { recentReferenceContext } : {}
	};
}
function compileStage(messages) {
	return messages.some((message) => message.role === "user" || message.role === "tool") ? "write_hot_path" : "post_answer_writeback";
}
function scaffoldTurnSemantics(params) {
	const { messages } = params;
	return {
		sourceRefs: messages.map((message) => sourceRefForMessage(message)),
		referenceContext: buildRecentReferenceContext(params),
		chunkDrafts: [],
		assertionDrafts: [],
		correctionDrafts: [],
		relationDrafts: [],
		resourceAssertions: [],
		adviceSignals: [],
		supportSpans: [],
		compilerProvenance: {
			source: "deterministic",
			mode: "fallback",
			reasons: ["llm-only-turn-compiler-scaffold"]
		}
	};
}
function normalizeCompilerRelationDrafts(relationDrafts) {
	return (relationDrafts ?? []).map((entry) => {
		const predicate = String(entry.relation.predicate);
		if (predicate !== "owned_by" && predicate !== "blocked_by") return entry;
		return {
			...entry,
			relation: {
				...entry.relation,
				subject: entry.relation.object,
				predicate: predicate === "owned_by" ? "owner_of" : "blocks",
				object: entry.relation.subject,
				rawPredicate: entry.relation.rawPredicate ?? predicate
			}
		};
	});
}
function mergeCompilerFrame(base, patch) {
	return {
		...base,
		...patch,
		sourceRefs: patch.sourceRefs && patch.sourceRefs.length > 0 ? patch.sourceRefs : base.sourceRefs,
		chunkDrafts: patch.chunkDrafts && patch.chunkDrafts.length > 0 ? patch.chunkDrafts : base.chunkDrafts,
		taskProposal: patch.taskProposal ?? base.taskProposal,
		assertionDrafts: patch.assertionDrafts ?? [],
		correctionDrafts: patch.correctionDrafts ?? [],
		relationDrafts: normalizeCompilerRelationDrafts(patch.relationDrafts),
		resourceAssertions: patch.resourceAssertions ?? [],
		adviceSignals: patch.adviceSignals ?? [],
		supportSpans: patch.supportSpans && patch.supportSpans.length > 0 ? patch.supportSpans : base.supportSpans,
		compilerProvenance: patch.compilerProvenance ?? {
			source: "llm",
			mode: "semantic-compiler-authoritative",
			reasons: ["llm-semantic-fields-explicit"]
		}
	};
}
function semanticDraftForSourceRef(frame, sourceRef) {
	const assertionDrafts = frame.assertionDrafts.filter((entry) => entry.sourceRef === sourceRef);
	const correctionDrafts = frame.correctionDrafts.filter((entry) => entry.sourceRef === sourceRef);
	const isTurnPrimarySource = sourceRef === frame.sourceRefs[0];
	const relationDrafts = (frame.relationDrafts ?? []).filter((entry) => entry.sourceRef === sourceRef || isTurnPrimarySource).map((entry) => ({
		...entry,
		relation: {
			...entry.relation,
			sourceRef: entry.relation.sourceRef ?? entry.sourceRef
		}
	}));
	const resourceAssertions = (frame.resourceAssertions ?? []).filter((entry) => entry.sourceRef === sourceRef);
	const adviceSignals = (frame.adviceSignals ?? []).filter((entry) => entry.sourceRefs.includes(sourceRef));
	const supportSpans = frame.supportSpans.filter((entry) => entry.sourceRef === sourceRef);
	if (assertionDrafts.length === 0 && correctionDrafts.length === 0 && relationDrafts.length === 0 && resourceAssertions.length === 0 && adviceSignals.length === 0 && supportSpans.length === 0) return;
	return {
		sourceRef,
		assertionDrafts,
		correctionDrafts,
		relationDrafts,
		resourceAssertions,
		adviceSignals,
		supportSpans,
		taskProposal: frame.taskProposal,
		compilerProvenance: frame.compilerProvenance
	};
}
function affirmedRelationDrafts(draft) {
	return (draft.relationDrafts ?? []).filter((entry) => entry.relation.polarity !== "negated");
}
function primaryFamily(draft) {
	for (const family of [
		"workflow",
		"strategy_like",
		"preference",
		"fact_like",
		"relation_like",
		"event_like"
	]) if (draft.assertionDrafts.some((entry) => entry.familyHint === family)) return family;
	if (affirmedRelationDrafts(draft).length > 0) return "relation_like";
}
function draftMaterializationHint(draft) {
	const primary = primaryFamily(draft);
	const correction = draft.correctionDrafts[0]?.correction;
	const timeframeHint = correction?.timeframe ?? draft.assertionDrafts[0]?.timeframeHint;
	if (!primary && !correction) return;
	const reasons = [];
	if (primary) reasons.push(`primary-family:${primary}`);
	if (correction?.timeframe) reasons.push(`correction-timeframe:${correction.timeframe}`);
	return {
		sourceRef: draft.sourceRef,
		...primary ? { primaryFamily: primary } : {},
		...timeframeHint ? { timeframeHint } : {},
		...primary === "strategy_like" ? { preferGuidanceFact: true } : {},
		...primary === "event_like" || correction?.timeframe === "historical" || correction?.timeframe === "compare" ? { preferEvent: true } : {},
		...correction?.targetKind === "fact" && correction.priorValue && correction.nextValue ? { replacementMode: "supersede_fact" } : {},
		reasons
	};
}
function frameHintsForSourceRef(frame, sourceRef) {
	if (!frame) return;
	const semanticDraft = semanticDraftForSourceRef(frame, sourceRef);
	if (!semanticDraft) return;
	const correction = semanticDraft.correctionDrafts[0]?.correction;
	const relevantDrafts = semanticDraft.assertionDrafts;
	const relationDrafts = affirmedRelationDrafts(semanticDraft);
	const semanticFamilies = [...new Set(relevantDrafts.map((entry) => entry.familyHint))];
	if (relationDrafts.length > 0 && !semanticFamilies.includes("relation_like")) semanticFamilies.push("relation_like");
	const semanticTimeframes = [...new Set(relevantDrafts.map((entry) => entry.timeframeHint))];
	const slotHints = [...new Set(relevantDrafts.flatMap((entry) => Array.isArray(entry.slotHints) ? entry.slotHints.filter(Boolean) : []))];
	const entityHints = relevantDrafts.flatMap((entry) => entry.entityHints ?? []);
	return {
		...relevantDrafts.some((entry) => entry.familyHint === "workflow") ? { taskStateHint: true } : {},
		...relevantDrafts.some((entry) => entry.familyHint === "preference") ? { preferenceHint: true } : {},
		...relevantDrafts.some((entry) => entry.familyHint === "relation_like") ? { relationHint: true } : {},
		...relationDrafts.length > 0 ? {
			relationHint: true,
			relation: relationDrafts[0]?.relation,
			relations: relationDrafts.map((entry) => entry.relation)
		} : {},
		...correction ? {
			correctionHint: true,
			correction
		} : {},
		...semanticFamilies.length > 0 ? { semanticFamilies } : {},
		...semanticTimeframes.length > 0 ? { semanticTimeframes } : {},
		...slotHints.length > 0 ? { slotHints } : {},
		...entityHints.length > 0 ? { entities: entityHints } : {},
		...(semanticDraft.resourceAssertions?.length ?? 0) > 0 ? { resourceAssertions: semanticDraft.resourceAssertions } : {},
		...(semanticDraft.adviceSignals?.length ?? 0) > 0 ? { adviceSignals: semanticDraft.adviceSignals } : {},
		semanticDraft,
		materializationHint: draftMaterializationHint(semanticDraft)
	};
}
async function compileTurnSemantics(params) {
	const stage = compileStage(params.messages);
	if (!params.ctx.config.advanced.enableTurnSemanticCompiler) return;
	const fallback = scaffoldTurnSemantics(params);
	if (!params.reasoner?.isEnabled?.() || !params.reasoner.compileTurnSemantics) {
		recordMemoryLlmBudgetCall(params.ctx.llmBudgetAudit, {
			label: "turn-semantic-compile",
			stage,
			provenance: "deterministic",
			mode: "fallback",
			detail: "turnSemanticCompiler emitted scaffold only; no semantic fields were synthesized"
		});
		return fallback;
	}
	const compiled = await params.reasoner.compileTurnSemantics(params.messages, fallback, {
		stage,
		audit: params.ctx.llmBudgetAudit
	});
	if (!compiled) return {
		...fallback,
		compilerProvenance: {
			source: "hybrid",
			mode: "fallback",
			reasons: ["turn-compile-fallback"]
		}
	};
	return mergeCompilerFrame(fallback, compiled);
}
//#endregion
export { buildLongTurnSemanticScanInputFromSegments, buildTurnSemanticCompilerInput, compileTurnSemantics, frameHintsForSourceRef };
