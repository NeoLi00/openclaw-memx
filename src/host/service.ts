import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MEMORY_CONFIG, memxConfigSchema } from "../config.js";
import { compileQuery } from "../pipeline/queryCompiler.js";
import { retrieveEvidence } from "../pipeline/retrieve.js";
import { captureAgentEndTurn } from "../pipeline/turnCapture.js";
import { buildOperationContext, MemxRuntimeManager, type MemxStoreBundle } from "../runtime.js";
import { resolveDefaultScope } from "../security/scopes.js";
import { nowIso, randomId, stableHash, truncateText } from "../support.js";
import type { EvidenceBundle, MemoryOperationContext, MemoryPluginConfig, MemxLogger } from "../types.js";
import { normalizeObservePayload, type MemxTurnEnvelope } from "./hookPayload.js";

const DEFAULT_SERVER_DB_PATH = join(homedir(), ".memx", "{agentId}", "memx.sqlite");
const DEFAULT_SERVICE_CONFIG_PATH = join(homedir(), ".memx", "config.json");

export type MemxServiceOptions = {
  config?: MemoryPluginConfig;
  logger?: MemxLogger;
};

export type MemxRecallRequest = {
  query: string;
  limit?: number;
  hostId?: string;
  actorId?: string;
  sessionId?: string;
  workspaceDir?: string;
  project?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isRecord(base) || !isRecord(override)) {
    return (override === undefined ? base : override) as T;
  }
  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    output[key] = key in output ? deepMerge(output[key], value) : value;
  }
  return output as T;
}

function serviceDefaultConfig(): MemoryPluginConfig {
  const config = structuredClone(DEFAULT_MEMORY_CONFIG);
  config.dbPath = DEFAULT_SERVER_DB_PATH;
  config.defaultScope = "agent:{agentId}";
  config.allowedScopes = ["global", "agent:{agentId}", "session:{sessionKey}", "project:{project}"];
  return config;
}

function readServiceConfigFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function applyServiceEnvOverrides(config: MemoryPluginConfig, env: NodeJS.ProcessEnv): MemoryPluginConfig {
  const next = structuredClone(config);
  next.dbPath = env["MEMX_DB_PATH"]?.trim() || next.dbPath;
  next.defaultScope = env["MEMX_DEFAULT_SCOPE"]?.trim() || next.defaultScope;
  if (
    env["MEMX_LLM_PROVIDER"] === "openai-compatible" ||
    env["MEMX_LLM_PROVIDER"] === "anthropic" ||
    env["MEMX_LLM_PROVIDER"] === "google" ||
    env["MEMX_LLM_PROVIDER"] === "ollama"
  ) {
    next.advanced.llmProvider = env["MEMX_LLM_PROVIDER"];
  }
  if (env["MEMX_LLM_BASE_URL"]) {
    next.advanced.llmBaseURL = env["MEMX_LLM_BASE_URL"];
  }
  if (env["MEMX_LLM_API_KEY"]) {
    next.advanced.llmApiKey = env["MEMX_LLM_API_KEY"];
  }
  if (env["MEMX_LLM_MODEL"]) {
    next.advanced.llmClassifierModel = env["MEMX_LLM_MODEL"];
  }
  if (env["MEMX_EMBEDDING_PROVIDER"]) {
    const provider = env["MEMX_EMBEDDING_PROVIDER"];
    if (
      provider === "off" ||
      provider === "openai-compatible" ||
      provider === "ollama" ||
      provider === "sentence-transformers-local"
    ) {
      next.embedding.provider = provider;
    }
  }
  if (env["MEMX_EMBEDDING_MODEL"]) {
    next.embedding.model = env["MEMX_EMBEDDING_MODEL"];
  }
  if (env["MEMX_EMBEDDING_BASE_URL"]) {
    next.embedding.baseURL = env["MEMX_EMBEDDING_BASE_URL"];
  }
  if (env["MEMX_EMBEDDING_API_KEY"]) {
    next.embedding.apiKey = env["MEMX_EMBEDDING_API_KEY"];
  }
  if (env["MEMX_EMBEDDING_OLLAMA_BASE_URL"]) {
    next.embedding.ollamaBaseURL = env["MEMX_EMBEDDING_OLLAMA_BASE_URL"];
  }
  if (env["MEMX_EMBEDDING_PYTHON"]) {
    next.embedding.localPythonBin = env["MEMX_EMBEDDING_PYTHON"];
  }
  if (env["MEMX_EMBEDDING_CACHE_DIR"]) {
    next.embedding.localCacheDir = env["MEMX_EMBEDDING_CACHE_DIR"];
  }
  if (
    env["MEMX_EMBEDDING_DEVICE"] === "auto" ||
    env["MEMX_EMBEDDING_DEVICE"] === "cpu" ||
    env["MEMX_EMBEDDING_DEVICE"] === "mps" ||
    env["MEMX_EMBEDDING_DEVICE"] === "cuda"
  ) {
    next.embedding.localDevice = env["MEMX_EMBEDDING_DEVICE"];
  }
  return memxConfigSchema.parse(next);
}

function loggerOrConsole(logger?: MemxLogger): MemxLogger {
  return (
    logger ?? {
      warn: (message) => console.warn(message),
      info: (message) => console.error(message),
      debug: () => {},
      error: (message) => console.error(message),
    }
  );
}

export function createServiceConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MemoryPluginConfig {
  const configPath = env["MEMX_CONFIG_PATH"]?.trim() || DEFAULT_SERVICE_CONFIG_PATH;
  const raw = deepMerge(serviceDefaultConfig(), readServiceConfigFile(configPath));
  return applyServiceEnvOverrides(memxConfigSchema.parse(raw), env);
}

function hostSessionKey(envelope: Pick<MemxTurnEnvelope, "hostId" | "sessionId">): string {
  return `${envelope.hostId}:${envelope.sessionId || "default"}`;
}

function asEnvelopeContext(
  config: MemoryPluginConfig,
  envelope: Pick<MemxTurnEnvelope, "actorId" | "sessionId" | "hostId" | "workspaceDir" | "project" | "runId">,
): MemoryOperationContext {
  const ctx = buildOperationContext(config, {
    agentId: envelope.actorId || "memx-shared",
    sessionKey: hostSessionKey(envelope),
    workspaceDir: envelope.workspaceDir,
    project: envelope.project,
    runId: envelope.runId,
  });
  if (!ctx) {
    throw new Error("unable to build MemX operation context");
  }
  return ctx;
}

function countTable(store: MemxStoreBundle, table: string): number {
  const row = store.client.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as
    | { count: number }
    | undefined;
  return Number(row?.count ?? 0);
}

function formatEvidenceRows(title: string, rows: Array<{ text: string; observedAt?: string }>, limit: number): string[] {
  if (rows.length === 0) {
    return [];
  }
  return [
    `## ${title}`,
    ...rows.slice(0, limit).map((row) => {
      const date = row.observedAt ? ` [${row.observedAt.slice(0, 10)}]` : "";
      return `- ${truncateText(row.text, 360)}${date}`;
    }),
  ];
}

function formatRecallContext(bundle: EvidenceBundle, limit: number): string {
  const lines = [
    "## MemX Memory",
    "Use the following remembered context only when it directly helps the current request.",
    ...formatEvidenceRows("Guidance", bundle.behavioralGuidance.map((text) => ({ text })), Math.min(limit, 4)),
    ...formatEvidenceRows("State", bundle.states, limit),
    ...formatEvidenceRows("Facts", bundle.facts, limit),
    ...formatEvidenceRows("Events", bundle.events, limit),
    ...formatEvidenceRows(
      "Graph",
      bundle.graph.paths.map((path) => ({ text: path.summary })),
      Math.min(limit, 4),
    ),
  ].filter((line) => line.trim().length > 0);
  return lines.join("\n");
}

export class MemxHostService {
  private readonly config: MemoryPluginConfig;
  private readonly logger: MemxLogger;
  private readonly manager: MemxRuntimeManager;

  constructor(options: MemxServiceOptions = {}) {
    this.config = options.config ?? createServiceConfigFromEnv();
    this.logger = loggerOrConsole(options.logger);
    this.manager = new MemxRuntimeManager(this.logger);
  }

  async close(): Promise<void> {
    await this.manager.closeAll();
  }

  async observe(input: unknown): Promise<Record<string, unknown>> {
    const envelope = normalizeObservePayload(input);
    const ctx = asEnvelopeContext(this.config, envelope);
    const store = await this.manager.getStore(ctx);
    const scope = resolveDefaultScope(this.config, {
      agentId: ctx.agentId,
      sessionKey: ctx.sessionKey,
      project: ctx.project,
      workspace: ctx.workspaceDir,
    });
    const turnId = randomId("turn");
    const captured = captureAgentEndTurn({
      agentId: ctx.agentId,
      scope,
      sessionKey: ctx.sessionKey ?? "default",
      turnId,
      observedAt: envelope.observedAt || nowIso(),
      messages: envelope.messages,
    });
    if (captured.length === 0) {
      return { ok: true, accepted: false, reason: "no-capturable-messages" };
    }
    void store.turnScheduler
      .enqueue(ctx, captured)
      .then(() =>
        this.manager.recordMaintenanceTurn(ctx, {
          store,
          turnId,
          observedAt: captured.at(-1)?.observedAt ?? ctx.now,
        }),
      )
      .catch((error) => {
        this.logger.warn(`memory-memx: host observe flush failed (${String(error)})`);
      });
    return {
      ok: true,
      accepted: true,
      hostId: envelope.hostId,
      actorId: ctx.agentId,
      sessionKey: ctx.sessionKey,
      turnId,
      captured: captured.length,
    };
  }

  async recall(request: MemxRecallRequest): Promise<Record<string, unknown>> {
    if (!request.query?.trim()) {
      throw new Error("query required");
    }
    const envelope: MemxTurnEnvelope = {
      hostId: request.hostId === "codex" || request.hostId === "claude-code" ? request.hostId : "generic",
      actorId: request.actorId || process.env["MEMX_ACTOR_ID"] || "memx-shared",
      sessionId: request.sessionId || "mcp",
      workspaceDir: request.workspaceDir || process.cwd(),
      project: request.project,
      eventName: "recall",
      observedAt: nowIso(),
      messages: [{ role: "user", content: request.query }],
    };
    const ctx = asEnvelopeContext(this.config, envelope);
    const store = await this.manager.getStore({
      ...ctx,
      readEpoch: 0,
    });
    const recallCtx = {
      ...ctx,
      readEpoch: store.client.currentMemoryEpoch(ctx.agentId),
    };
    const compiled = await compileQuery({
      query: request.query,
      ctx: recallCtx,
      reasoner: store.reasoner,
    });
    const bundle = await retrieveEvidence(store, recallCtx, request.query, compiled.focusedQuery, {
      queryAnalysis: compiled,
    });
    const limit = Math.max(1, Math.min(Math.trunc(request.limit ?? 6), 24));
    return {
      ok: true,
      routeType: bundle.routeType,
      routeConfidence: bundle.routeConfidence,
      focusedQuery: compiled.focusedQuery,
      context: formatRecallContext(bundle, limit),
      states: bundle.states.slice(0, limit),
      facts: bundle.facts.slice(0, limit),
      events: bundle.events.slice(0, limit),
      graph: {
        paths: bundle.graph.paths.slice(0, Math.min(limit, 6)),
        edges: bundle.graph.edges.slice(0, Math.min(limit, 12)),
      },
      diagnostics: bundle.diagnostics,
    };
  }

  async remember(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const content = typeof request.content === "string" ? request.content.trim() : "";
    if (!content) {
      throw new Error("content required");
    }
    return this.observe({
      hostId: request.hostId ?? "generic",
      actorId: request.actorId ?? process.env["MEMX_ACTOR_ID"] ?? "memx-shared",
      sessionId: request.sessionId ?? "manual",
      workspaceDir: request.workspaceDir ?? process.cwd(),
      eventName: "remember",
      observedAt: nowIso(),
      messages: [{ role: "user", content }],
      metadata: { manual: true, memoryType: request.type },
    });
  }

  async forget(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = typeof request.id === "string" ? request.id.trim() : "";
    if (!id) {
      throw new Error("id required");
    }
    const ctx = asEnvelopeContext(this.config, {
      hostId: "generic",
      actorId: typeof request.actorId === "string" ? request.actorId : "memx-shared",
      sessionId: typeof request.sessionId === "string" ? request.sessionId : "manual",
    });
    const store = await this.manager.getStore(ctx);
    const kind = typeof request.kind === "string" ? request.kind : "doc";
    let deleted = 0;
    if (kind === "event") {
      deleted = store.eventRepo.delete({ agentId: ctx.agentId, eventId: id });
      store.vectorRepo.deleteDocs([`event:${id}`]);
    } else if (kind === "fact") {
      deleted = store.factRepo.markDeleted({ agentId: ctx.agentId, factId: id });
      store.vectorRepo.deleteDocs([`fact:${id}`]);
    } else if (kind === "state") {
      deleted = store.stateRepo.delete({ agentId: ctx.agentId, key: id });
      store.vectorRepo.deleteDocs([`state:${id}`]);
    } else {
      store.vectorRepo.deleteDocs([id]);
      deleted = 1;
    }
    return { ok: true, deleted, kind, id };
  }

  async stats(): Promise<Record<string, unknown>> {
    const ctx = asEnvelopeContext(this.config, {
      hostId: "generic",
      actorId: process.env["MEMX_ACTOR_ID"] || "memx-shared",
      sessionId: "stats",
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
      vectorDocCount: countTable(store, "vector_docs"),
    };
  }

  async audit(limit = 50): Promise<Record<string, unknown>> {
    const ctx = asEnvelopeContext(this.config, {
      hostId: "generic",
      actorId: process.env["MEMX_ACTOR_ID"] || "memx-shared",
      sessionId: "audit",
    });
    const store = await this.manager.getStore(ctx);
    return {
      ok: true,
      signals: store.auditRepo.listSignals({
        agentId: ctx.agentId,
        limit: Math.max(1, Math.min(Math.trunc(limit), 200)),
      }),
    };
  }

  async context(request: MemxRecallRequest): Promise<Record<string, unknown>> {
    const recalled = await this.recall(request);
    return {
      ok: true,
      prependContext: recalled.context,
      recall: recalled,
    };
  }
}

export function stableHostTurnId(envelope: MemxTurnEnvelope): string {
  return stableHash([envelope.hostId, envelope.actorId, envelope.sessionId, envelope.observedAt]);
}
