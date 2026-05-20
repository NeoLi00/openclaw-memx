import { normalizeText, nowIso, randomId, stableHash, truncateText } from "../support.mjs";
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
function formatRecallContext(bundle, limit) {
	const graphPaths = Array.isArray(bundle.graph?.paths) ? bundle.graph.paths : [];
	const evidenceLines = [
		...formatEvidenceRows("Guidance", bundle.behavioralGuidance.map((text) => ({ text })), Math.min(limit, 4)),
		...formatEvidenceRows("State", bundle.states, limit),
		...formatEvidenceRows("Facts", bundle.facts, limit),
		...formatEvidenceRows("Events", bundle.events, limit),
		...formatEvidenceRows("Graph", graphPaths.map((path) => ({ text: path.summary })), Math.min(limit, 4))
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
function packetPromptText(packet) {
	return [
		packet.primaryText,
		...packet.displayLines ?? [],
		...packet.supportingTexts,
		...packet.entityAliases ?? []
	].filter(Boolean).join("\n");
}
function bestInjectedPacketScore(packets) {
	return packets.reduce((best, packet) => Math.max(best, packet.grade?.finalScore ?? packet.score ?? packet.coverage.confidence ?? 0), 0);
}
function hasExplicitMemoryIntent(query) {
	const normalized = normalizeText(query);
	return /\b(remember|recall|previous|previously|earlier|last time|what did i|what was my|what were my|my .{0,40}(preference|preferences|config|configuration|requirement|requirements|constraint|constraints|command|field|account|token|key))\b/iu.test(normalized) || /(之前|上次|刚才|曾经|以前|历史|记得|记住|我说过|我提到|我提过|还记得|回忆|记忆)/u.test(normalized) || /我的.{0,24}(偏好|配置|要求|约束|命令|字段|账号|地址|密钥|是什么|有哪些|多少)/u.test(normalized);
}
function distinctiveQueryAnchors(query) {
	const anchors = /* @__PURE__ */ new Set();
	for (const match of query.matchAll(/[A-Za-z][A-Za-z0-9_:-]{3,}/gu)) {
		const token = match[0];
		if (/[A-Z]/u.test(token) || /[_:-]|\d/u.test(token) || token.length >= 8) anchors.add(token.toLowerCase());
	}
	return [...anchors].slice(0, 8);
}
function hasDistinctivePacketAnchor(query, packets) {
	const anchors = distinctiveQueryAnchors(query);
	if (anchors.length === 0) return false;
	return packets.some((packet) => {
		const haystack = packetPromptText(packet).toLowerCase();
		return anchors.some((anchor) => haystack.includes(anchor));
	});
}
function assessNativeContextEligibility(query, queryAnalysis, bundle) {
	const packets = injectedPackets(bundle);
	if (packets.length === 0) return {
		eligible: false,
		reason: "no-injected-packets",
		bestScore: 0
	};
	const bestScore = bestInjectedPacketScore(packets);
	const explicitMemoryIntent = hasExplicitMemoryIntent(query);
	const distinctiveAnchor = hasDistinctivePacketAnchor(query, packets);
	if (!(bestScore >= .62 || bundle.routeConfidence >= .68 || packets.some((packet) => packet.coverage.filled && packet.coverage.confidence >= .58)) && !explicitMemoryIntent && !distinctiveAnchor) return {
		eligible: false,
		reason: "weak-evidence",
		bestScore
	};
	if (explicitMemoryIntent) return {
		eligible: true,
		reason: "explicit-memory-intent",
		bestScore
	};
	if (distinctiveAnchor) return {
		eligible: true,
		reason: "distinctive-query-anchor",
		bestScore
	};
	if (queryAnalysis.queryEntities.length > 0) return {
		eligible: true,
		reason: "llm-query-entities",
		bestScore
	};
	return {
		eligible: false,
		reason: "no-memory-intent-or-anchor",
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
			reasoner: store.reasoner
		});
		const bundle = await retrieveEvidence(store, recallCtx, request.query, compiled.focusedQuery, { queryAnalysis: compiled });
		const limit = Math.max(1, Math.min(Math.trunc(request.limit ?? 6), 24));
		const contextEligibility = assessNativeContextEligibility(request.query, compiled, bundle);
		const graphPaths = Array.isArray(bundle.graph?.paths) ? bundle.graph.paths : [];
		const graphEdges = Array.isArray(bundle.graph?.edges) ? bundle.graph.edges : [];
		return {
			ok: true,
			routeType: bundle.routeType,
			routeConfidence: bundle.routeConfidence,
			focusedQuery: compiled.focusedQuery,
			context: formatRecallContext(bundle, limit),
			contextEligibility,
			states: bundle.states.slice(0, limit),
			facts: bundle.facts.slice(0, limit),
			events: bundle.events.slice(0, limit),
			graph: {
				paths: graphPaths.slice(0, Math.min(limit, 6)),
				edges: graphEdges.slice(0, Math.min(limit, 12))
			},
			diagnostics: bundle.diagnostics
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
		if (eligibility && !eligibility.eligible) this.logger.info?.(`memx: native context withheld reason=${eligibility.reason} best=${eligibility.bestScore.toFixed(2)} query="${request.query.slice(0, 80)}"`);
		return {
			ok: true,
			prependContext: eligibility?.eligible === false ? "" : recalled.context,
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
export { MemxHostService, assessNativeContextEligibility, createServiceConfigFromEnv, stableHostTurnId };
