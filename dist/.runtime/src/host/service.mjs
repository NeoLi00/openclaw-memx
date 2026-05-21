import { normalizeName, nowIso, randomId, stableHash, truncateText } from "../support.mjs";
import { normalizeObservePayload } from "./hookPayload.mjs";
import { DEFAULT_MEMORY_CONFIG, memxConfigSchema } from "../config.mjs";
import { compileQuery } from "../pipeline/queryCompiler.mjs";
import { retrieveEvidence } from "../pipeline/retrieve.mjs";
import { captureAgentEndTurn } from "../pipeline/turnCapture.mjs";
import { resolveDefaultScope } from "../security/scopes.mjs";
import { MemxRuntimeManager, buildOperationContext } from "../runtime.mjs";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
//#region src/host/service.ts
const DEFAULT_SERVER_DB_PATH = join(homedir(), ".memx", "{agentId}", "memx.sqlite");
const DEFAULT_SERVICE_CONFIG_PATH = join(homedir(), ".memx", "config.json");
function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function deepMerge(base, override) {
	if (!isRecord(base) || !isRecord(override)) return override === void 0 ? base : override;
	const output = { ...base };
	for (const [key, value] of Object.entries(override)) output[key] = key in output ? deepMerge(output[key], value) : value;
	return output;
}
function serviceDefaultConfig() {
	const config = structuredClone(DEFAULT_MEMORY_CONFIG);
	config.dbPath = DEFAULT_SERVER_DB_PATH;
	config.defaultScope = "agent:{agentId}";
	config.allowedScopes = [
		"global",
		"agent:{agentId}",
		"session:{sessionKey}",
		"project:{project}"
	];
	return config;
}
function readServiceConfigFile(path) {
	if (!existsSync(path)) return {};
	return JSON.parse(readFileSync(path, "utf8"));
}
function applyServiceEnvOverrides(config, env) {
	const next = structuredClone(config);
	next.dbPath = env["MEMX_DB_PATH"]?.trim() || next.dbPath;
	next.defaultScope = env["MEMX_DEFAULT_SCOPE"]?.trim() || next.defaultScope;
	if (env["MEMX_LLM_PROVIDER"] === "openai-compatible" || env["MEMX_LLM_PROVIDER"] === "anthropic" || env["MEMX_LLM_PROVIDER"] === "google" || env["MEMX_LLM_PROVIDER"] === "ollama") next.advanced.llmProvider = env["MEMX_LLM_PROVIDER"];
	if (env["MEMX_LLM_BASE_URL"]) next.advanced.llmBaseURL = env["MEMX_LLM_BASE_URL"];
	if (env["MEMX_LLM_API_KEY"]) next.advanced.llmApiKey = env["MEMX_LLM_API_KEY"];
	if (env["MEMX_LLM_MODEL"]) next.advanced.llmClassifierModel = env["MEMX_LLM_MODEL"];
	if (env["MEMX_EMBEDDING_PROVIDER"]) {
		const provider = env["MEMX_EMBEDDING_PROVIDER"];
		if (provider === "off" || provider === "openai-compatible" || provider === "ollama" || provider === "sentence-transformers-local") next.embedding.provider = provider;
	}
	if (env["MEMX_EMBEDDING_MODEL"]) next.embedding.model = env["MEMX_EMBEDDING_MODEL"];
	if (env["MEMX_EMBEDDING_BASE_URL"]) next.embedding.baseURL = env["MEMX_EMBEDDING_BASE_URL"];
	if (env["MEMX_EMBEDDING_API_KEY"]) next.embedding.apiKey = env["MEMX_EMBEDDING_API_KEY"];
	if (env["MEMX_EMBEDDING_OLLAMA_BASE_URL"]) next.embedding.ollamaBaseURL = env["MEMX_EMBEDDING_OLLAMA_BASE_URL"];
	if (env["MEMX_EMBEDDING_PYTHON"]) next.embedding.localPythonBin = env["MEMX_EMBEDDING_PYTHON"];
	if (env["MEMX_EMBEDDING_CACHE_DIR"]) next.embedding.localCacheDir = env["MEMX_EMBEDDING_CACHE_DIR"];
	if (env["MEMX_EMBEDDING_DEVICE"] === "auto" || env["MEMX_EMBEDDING_DEVICE"] === "cpu" || env["MEMX_EMBEDDING_DEVICE"] === "mps" || env["MEMX_EMBEDDING_DEVICE"] === "cuda") next.embedding.localDevice = env["MEMX_EMBEDDING_DEVICE"];
	return memxConfigSchema.parse(next);
}
function loggerOrConsole(logger) {
	return logger ?? {
		warn: (message) => console.warn(message),
		info: (message) => console.error(message),
		debug: () => {},
		error: (message) => console.error(message)
	};
}
function createServiceConfigFromEnv(env = process.env) {
	const configPath = env["MEMX_CONFIG_PATH"]?.trim() || DEFAULT_SERVICE_CONFIG_PATH;
	const raw = deepMerge(serviceDefaultConfig(), readServiceConfigFile(configPath));
	return applyServiceEnvOverrides(memxConfigSchema.parse(raw), env);
}
function hostSessionKey(envelope) {
	return `${envelope.hostId}:${envelope.sessionId || "default"}`;
}
function safeAgentPart(value, fallback) {
	return (value?.trim() || fallback).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}
function hostScopedAgentId(envelope) {
	const actor = safeAgentPart(envelope.actorId, "memx-shared");
	if (envelope.hostId === "generic") return actor;
	const hostPrefix = `${envelope.hostId}--`;
	return actor.startsWith(hostPrefix) ? actor : `${hostPrefix}${actor}`;
}
function asEnvelopeContext(config, envelope) {
	const ctx = buildOperationContext(config, {
		agentId: hostScopedAgentId(envelope),
		sessionKey: hostSessionKey(envelope),
		workspaceDir: envelope.workspaceDir,
		project: envelope.project,
		runId: envelope.runId
	});
	if (!ctx) throw new Error("unable to build memX operation context");
	return ctx;
}
function countTable(store, table) {
	const row = store.client.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
	return Number(row?.count ?? 0);
}
function formatEvidenceRows(title, rows, limit) {
	const usableRows = rows.filter((row) => typeof row.text === "string" && row.text.trim().length > 0);
	if (usableRows.length === 0) return [];
	return [`## ${title}`, ...usableRows.slice(0, limit).map((row) => {
		const date = row.observedAt ? ` [${row.observedAt.slice(0, 10)}]` : "";
		return `- ${truncateText(row.text ?? "", 360)}${date}`;
	})];
}
function graphPathText(path) {
	if (typeof path === "string") return path;
	if (isRecord(path) && typeof path.summary === "string") return path.summary;
	return "";
}
function formatRecallContext(bundle, limit) {
	const graphPaths = Array.isArray(bundle.graph?.paths) ? bundle.graph.paths : [];
	const evidenceLines = [
		...formatEvidenceRows("Guidance", bundle.behavioralGuidance.map((text) => ({ text })), Math.min(limit, 4)),
		...formatEvidenceRows("State", bundle.states, limit),
		...formatEvidenceRows("Facts", bundle.facts, limit),
		...formatEvidenceRows("Events", bundle.events, limit),
		...formatEvidenceRows("Graph", graphPaths.map((path) => ({ text: graphPathText(path) })), Math.min(limit, 4))
	].filter((line) => line.trim().length > 0);
	if (evidenceLines.length === 0) return "";
	return [
		"## memX Memory",
		"Use the following remembered context only when it directly helps the current request.",
		...evidenceLines
	].join("\n");
}
function injectedPackets(bundle) {
	return bundle.evidencePackets.filter((packet) => packet.injected && !packet.dropReason);
}
function bestInjectedPacketScore(packets) {
	return packets.reduce((best, packet) => Math.max(best, packet.grade?.finalScore ?? packet.score ?? packet.coverage.confidence ?? 0), 0);
}
function packetTextForSuppression(packet) {
	return [
		packet.primaryText,
		...packet.supportingTexts,
		...packet.displayLines ?? [],
		...packet.entityAliases ?? [],
		packet.answerCandidate?.text,
		...(packet.contextCandidates ?? []).map((candidate) => candidate.text)
	].filter((value) => typeof value === "string" && value.trim().length > 0).join("\n");
}
function packetMentionsSuppressedEntity(packet, queryAnalysis) {
	const suppressed = queryAnalysis.suppressedEntities ?? [];
	if (suppressed.length === 0) return false;
	const normalizedPacketText = normalizeName(packetTextForSuppression(packet));
	if (!normalizedPacketText) return false;
	return suppressed.some((entity) => {
		const normalizedEntity = normalizeName(entity.name);
		return normalizedEntity.length >= 2 && normalizedPacketText.includes(normalizedEntity);
	});
}
function entityFocusTerms(queryAnalysis) {
	const terms = /* @__PURE__ */ new Set();
	for (const entity of queryAnalysis.queryEntities ?? []) {
		const normalized = normalizeName(entity.name);
		if (normalized.length >= 2) terms.add(normalized);
	}
	return [...terms];
}
function textMentionsFocusEntity(text, terms) {
	if (!text || terms.length === 0) return false;
	const normalized = normalizeName(text);
	return terms.some((term) => normalized.includes(term));
}
function packetMentionsFocusEntity(packet, terms) {
	return textMentionsFocusEntity(packetTextForSuppression(packet), terms);
}
function focusEvidenceRows(rows, terms) {
	return rows.filter((row) => textMentionsFocusEntity(row.text, terms));
}
function hasFocusedEvidence(bundle) {
	return bundle.states.length > 0 || bundle.tasks.length > 0 || bundle.facts.length > 0 || bundle.events.length > 0 || bundle.graph.paths.length > 0 || bundle.behavioralGuidance.length > 0 || bundle.promptEvidence.length > 0 || bundle.evidencePackets.length > 0;
}
function focusRecallBundleForQueryEntities(queryAnalysis, bundle) {
	const terms = entityFocusTerms(queryAnalysis);
	if (terms.length === 0) return bundle;
	const focusedGraphNodes = bundle.graph.nodes.filter((node) => textMentionsFocusEntity(`${node.name} ${node.type}`, terms));
	const focusedNodeIds = new Set(focusedGraphNodes.map((node) => node.nodeId));
	const focused = {
		...bundle,
		states: focusEvidenceRows(bundle.states, terms),
		tasks: focusEvidenceRows(bundle.tasks, terms),
		facts: focusEvidenceRows(bundle.facts, terms),
		events: focusEvidenceRows(bundle.events, terms),
		alternates: focusEvidenceRows(bundle.alternates, terms),
		graph: {
			...bundle.graph,
			nodes: focusedGraphNodes,
			edges: focusedNodeIds.size > 0 ? bundle.graph.edges.filter((edge) => focusedNodeIds.has(edge.srcNodeId) || focusedNodeIds.has(edge.dstNodeId)) : [],
			pathCandidates: bundle.graph.pathCandidates.filter((candidate) => textMentionsFocusEntity(JSON.stringify(candidate), terms)),
			paths: bundle.graph.paths.filter((path) => textMentionsFocusEntity(graphPathText(path), terms))
		},
		behavioralGuidance: bundle.behavioralGuidance.filter((text) => textMentionsFocusEntity(text, terms)),
		recalledChunkTexts: bundle.recalledChunkTexts.filter((text) => textMentionsFocusEntity(text, terms)),
		promptEvidence: bundle.promptEvidence.filter((candidate) => textMentionsFocusEntity([
			candidate.text,
			candidate.rawText,
			candidate.scoringText
		].filter(Boolean).join("\n"), terms)),
		evidencePackets: bundle.evidencePackets.filter((packet) => packetMentionsFocusEntity(packet, terms))
	};
	return hasFocusedEvidence(focused) ? focused : bundle;
}
function assessNativeContextEligibility(_query, queryAnalysis, bundle) {
	const packets = injectedPackets(bundle);
	if (packets.length === 0) return {
		eligible: false,
		reason: "no-injected-packets",
		bestScore: 0
	};
	const bestScore = bestInjectedPacketScore(packets);
	if (packets.some((packet) => packetMentionsSuppressedEntity(packet, queryAnalysis))) return {
		eligible: false,
		reason: "suppressed-entity-anchor",
		bestScore
	};
	if (bestScore >= .62 || bundle.routeConfidence >= .68 || packets.some((packet) => packet.coverage.filled && packet.coverage.confidence >= .58)) return {
		eligible: true,
		reason: queryAnalysis.queryEntities.length > 0 ? "llm-query-entities" : "strong-evidence",
		bestScore
	};
	if (queryAnalysis.queryEntities.length > 0 && packets.some((packet) => packet.coverage.filled || (packet.coverage.confidence ?? 0) >= .35)) return {
		eligible: true,
		reason: "entity-supported-evidence",
		bestScore
	};
	return {
		eligible: false,
		reason: "weak-evidence",
		bestScore
	};
}
var MemxHostService = class {
	config;
	logger;
	manager;
	constructor(options = {}) {
		this.config = options.config ?? createServiceConfigFromEnv();
		this.logger = loggerOrConsole(options.logger);
		this.manager = new MemxRuntimeManager(this.logger);
	}
	async close() {
		await this.manager.closeAll();
	}
	async observe(input) {
		const envelope = normalizeObservePayload(input);
		const ctx = asEnvelopeContext(this.config, envelope);
		const store = await this.manager.getStore(ctx);
		const scope = resolveDefaultScope(this.config, {
			agentId: ctx.agentId,
			sessionKey: ctx.sessionKey,
			project: ctx.project,
			workspace: ctx.workspaceDir
		});
		const turnId = randomId("turn");
		const captured = captureAgentEndTurn({
			agentId: ctx.agentId,
			scope,
			sessionKey: ctx.sessionKey ?? "default",
			turnId,
			observedAt: envelope.observedAt || nowIso(),
			messages: envelope.messages
		});
		if (captured.length === 0) return {
			ok: true,
			accepted: false,
			reason: "no-capturable-messages"
		};
		store.turnScheduler.enqueue(ctx, captured).then(() => this.manager.recordMaintenanceTurn(ctx, {
			store,
			turnId,
			observedAt: captured.at(-1)?.observedAt ?? ctx.now
		})).catch((error) => {
			this.logger.warn(`memx: host observe flush failed (${String(error)})`);
		});
		return {
			ok: true,
			accepted: true,
			hostId: envelope.hostId,
			actorId: ctx.agentId,
			sessionKey: ctx.sessionKey,
			turnId,
			captured: captured.length
		};
	}
	async recall(request) {
		if (!request.query?.trim()) throw new Error("query required");
		const envelope = {
			hostId: request.hostId === "codex" || request.hostId === "claude-code" ? request.hostId : "generic",
			actorId: request.actorId || process.env["MEMX_ACTOR_ID"] || "memx-shared",
			sessionId: request.sessionId || "mcp",
			workspaceDir: request.workspaceDir || process.cwd(),
			project: request.project,
			eventName: "recall",
			observedAt: nowIso(),
			messages: [{
				role: "user",
				content: request.query
			}]
		};
		const ctx = asEnvelopeContext(this.config, envelope);
		const store = await this.manager.getStore({
			...ctx,
			readEpoch: 0
		});
		const recallCtx = {
			...ctx,
			readEpoch: store.client.currentMemoryEpoch(ctx.agentId)
		};
		const compiled = await compileQuery({
			query: request.query,
			ctx: recallCtx,
			reasoner: store.reasoner,
			hotPathTimeoutMs: request.hotPathTimeoutMs
		});
		const focusedBundle = focusRecallBundleForQueryEntities(compiled, await retrieveEvidence(store, recallCtx, request.query, compiled.focusedQuery, { queryAnalysis: compiled }));
		const limit = Math.max(1, Math.min(Math.trunc(request.limit ?? 6), 24));
		const contextEligibility = assessNativeContextEligibility(request.query, compiled, focusedBundle);
		const graphPaths = Array.isArray(focusedBundle.graph?.paths) ? focusedBundle.graph.paths : [];
		const graphEdges = Array.isArray(focusedBundle.graph?.edges) ? focusedBundle.graph.edges : [];
		return {
			ok: true,
			routeType: focusedBundle.routeType,
			routeConfidence: focusedBundle.routeConfidence,
			focusedQuery: compiled.focusedQuery,
			context: formatRecallContext(focusedBundle, limit),
			contextEligibility,
			states: focusedBundle.states.slice(0, limit),
			facts: focusedBundle.facts.slice(0, limit),
			events: focusedBundle.events.slice(0, limit),
			graph: {
				paths: graphPaths.slice(0, Math.min(limit, 6)),
				edges: graphEdges.slice(0, Math.min(limit, 12))
			},
			diagnostics: focusedBundle.diagnostics
		};
	}
	async remember(request) {
		const content = typeof request.content === "string" ? request.content.trim() : "";
		if (!content) throw new Error("content required");
		return this.observe({
			hostId: request.hostId ?? "generic",
			actorId: request.actorId ?? process.env["MEMX_ACTOR_ID"] ?? "memx-shared",
			sessionId: request.sessionId ?? "manual",
			workspaceDir: request.workspaceDir ?? process.cwd(),
			eventName: "remember",
			observedAt: nowIso(),
			messages: [{
				role: "user",
				content
			}],
			metadata: {
				manual: true,
				memoryType: request.type
			}
		});
	}
	async forget(request) {
		const id = typeof request.id === "string" ? request.id.trim() : "";
		if (!id) throw new Error("id required");
		const ctx = asEnvelopeContext(this.config, {
			hostId: "generic",
			actorId: typeof request.actorId === "string" ? request.actorId : "memx-shared",
			sessionId: typeof request.sessionId === "string" ? request.sessionId : "manual"
		});
		const store = await this.manager.getStore(ctx);
		const kind = typeof request.kind === "string" ? request.kind : "doc";
		let deleted = 0;
		if (kind === "event") {
			deleted = store.eventRepo.delete({
				agentId: ctx.agentId,
				eventId: id
			});
			store.vectorRepo.deleteDocs([`event:${id}`]);
		} else if (kind === "fact") {
			deleted = store.factRepo.markDeleted({
				agentId: ctx.agentId,
				factId: id
			});
			store.vectorRepo.deleteDocs([`fact:${id}`]);
		} else if (kind === "state") {
			deleted = store.stateRepo.delete({
				agentId: ctx.agentId,
				key: id
			});
			store.vectorRepo.deleteDocs([`state:${id}`]);
		} else {
			store.vectorRepo.deleteDocs([id]);
			deleted = 1;
		}
		return {
			ok: true,
			deleted,
			kind,
			id
		};
	}
	async stats() {
		const ctx = asEnvelopeContext(this.config, {
			hostId: "generic",
			actorId: process.env["MEMX_ACTOR_ID"] || "memx-shared",
			sessionId: "stats"
		});
		const store = await this.manager.getStore(ctx);
		return {
			ok: true,
			agentId: ctx.agentId,
			dbPath: ctx.dbPath,
			scopes: ctx.scopes,
			taskCount: countTable(store, "conversation_tasks"),
			chunkCount: countTable(store, "conversation_chunks"),
			stateCount: countTable(store, "state_kv"),
			factCount: countTable(store, "facts"),
			eventCount: countTable(store, "episodic_events"),
			edgeCount: countTable(store, "graph_edges"),
			vectorDocCount: countTable(store, "vector_docs")
		};
	}
	async audit(limit = 50) {
		const ctx = asEnvelopeContext(this.config, {
			hostId: "generic",
			actorId: process.env["MEMX_ACTOR_ID"] || "memx-shared",
			sessionId: "audit"
		});
		return {
			ok: true,
			signals: (await this.manager.getStore(ctx)).auditRepo.listSignals({
				agentId: ctx.agentId,
				limit: Math.max(1, Math.min(Math.trunc(limit), 200))
			})
		};
	}
	async context(request) {
		const recalled = await this.recall(request);
		const eligibility = recalled.contextEligibility;
		const candidateContext = typeof recalled.context === "string" ? recalled.context : "";
		const prependContext = eligibility?.eligible === false ? "" : candidateContext;
		if (eligibility && !eligibility.eligible) this.logger.info?.(`memx: native context withheld reason=${eligibility.reason} best=${eligibility.bestScore.toFixed(2)} query="${request.query.slice(0, 80)}"`);
		try {
			const envelope = {
				hostId: request.hostId === "codex" || request.hostId === "claude-code" ? request.hostId : "generic",
				actorId: request.actorId || process.env["MEMX_ACTOR_ID"] || "memx-shared",
				sessionId: request.sessionId || "mcp",
				workspaceDir: request.workspaceDir || process.cwd(),
				project: request.project,
				eventName: "context",
				observedAt: nowIso(),
				messages: [{
					role: "user",
					content: request.query
				}]
			};
			const ctx = asEnvelopeContext(this.config, envelope);
			const store = await this.manager.getStore(ctx);
			store.auditRepo.annotateLatestRetrievalInjection({
				agentId: ctx.agentId,
				queryText: request.query,
				candidateChars: candidateContext.length,
				actualInjectedChars: prependContext.length,
				eligible: eligibility?.eligible ?? true,
				reason: eligibility?.reason,
				finalizedAt: ctx.now
			});
			store.auditRepo.recordSignal({
				signalId: randomId("signal"),
				agentId: ctx.agentId,
				scope: ctx.scopes[0] ?? `agent:${ctx.agentId}`,
				sessionKey: ctx.sessionKey,
				signalType: "retrieval_support",
				memoryKind: "chunk",
				semanticKey: "native_context_injection",
				value: prependContext ? 1 : 0,
				sourceRef: `native_context:${stableHash([
					request.query,
					ctx.sessionKey,
					ctx.now
				])}`,
				metadataJson: {
					eligible: eligibility?.eligible ?? true,
					reason: eligibility?.reason,
					bestScore: eligibility?.bestScore,
					candidateChars: candidateContext.length,
					actualInjectedChars: prependContext.length
				},
				createdAt: ctx.now
			});
		} catch (error) {
			this.logger.debug?.(`memx: native context audit failed (${String(error)})`);
		}
		return {
			ok: true,
			prependContext,
			nativeContext: {
				eligible: eligibility?.eligible ?? true,
				reason: eligibility?.reason,
				candidateChars: candidateContext.length,
				actualInjectedChars: prependContext.length
			},
			recall: recalled
		};
	}
};
function stableHostTurnId(envelope) {
	return stableHash([
		envelope.hostId,
		envelope.actorId,
		envelope.sessionId,
		envelope.observedAt
	]);
}
//#endregion
export { MemxHostService, assessNativeContextEligibility, createServiceConfigFromEnv, focusRecallBundleForQueryEntities, stableHostTurnId };
