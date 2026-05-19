import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Command } from "commander";
import {
  LEGACY_MEMX_PLUGIN_ID,
  MEMX_BRAND_NAME,
  MEMX_PLUGIN_ID,
  withoutLegacyPluginIds,
} from "../identity.js";
import { runAbstractionJobs } from "../pipeline/abstractionJobs.js";
import { runAbstractionPromotion } from "../pipeline/abstractionPromotion.js";
import { runConsolidation } from "../pipeline/consolidate.js";
import { MemxReasoner, type ReasonerProbeReport } from "../pipeline/reasoner.js";
import { buildOperationContext, type MemxRuntimeManager } from "../runtime.js";
import { OptionalEmbeddingBackend } from "../search/backends/embeddingBackend.js";
import { nowIso, resolveUserPath } from "../support.js";
import type { MemoryPluginConfig } from "../types.js";

type OpenClawConfigLike = {
  agents?: {
    defaults?: Record<string, unknown>;
    list?: Array<{ id?: string }>;
  };
  plugins?: {
    allow?: string[];
    load?: { paths?: string[] };
    slots?: Record<string, string>;
    entries?: Record<string, Record<string, unknown>>;
  };
  models?: {
    providers?: Record<string, { baseUrl?: string; api?: string; models?: Array<{ id?: string }> }>;
  };
};

type MemxSetupOptions = {
  configPath?: string;
  enableLlmJudge?: boolean;
  llmModel?: string;
  embeddingProvider?: MemoryPluginConfig["embedding"]["provider"];
  embeddingModel?: string;
  embeddingPythonBin?: string;
  embeddingCacheDir?: string;
  embeddingDevice?: "auto" | "cpu" | "mps" | "cuda";
};

type MemxDoctorReport = {
  ok: boolean;
  configPath: string;
  reasonerConfigPath: string | null;
  pluginLoaded: boolean;
  checks: Array<{ key: string; ok: boolean; detail: string }>;
  recommendedFixes: string[];
  configSummary: {
    allowed: boolean;
    memorySlot: string | null;
    pluginEnabled: boolean;
    turnSchedulerEnabled: boolean;
    llmClassifierEnabled: boolean;
    llmClassifierModel: string | null;
    embeddingProvider: string | null;
    embeddingModel: string | null;
    dbPath: string | null;
  };
  reasonerProbe?: ReasonerProbeReport;
  embeddingProbe?: EmbeddingProbeReport;
};

type EmbeddingProbeReport = {
  enabled: boolean;
  ok: boolean;
  provider: string;
  model: string | null;
  dimension: number | null;
  durationMs: number;
  detail: string;
};

type MemxWipeStats = {
  agentId: string;
  dbPath: string;
  deleted: Record<string, number>;
  orphanEntitiesDeleted: number;
  orphanAliasesDeleted: number;
};

type MemxWipeDbStats = {
  dbPath: string;
  deleted: Record<string, number>;
};

const DEFAULT_USER_CONFIG_PATH = path.join(homedir(), ".openclaw", "openclaw.json");
const PLUGIN_ID = MEMX_PLUGIN_ID;

function defaultSetupEntry(
  config: MemoryPluginConfig,
  options: MemxSetupOptions,
): Record<string, unknown> {
  const llmClassifierEnabled =
    options.enableLlmJudge === true ? true : config.advanced.llmClassifierEnabled;
  const llmClassifierModel =
    options.llmModel?.trim() || config.advanced.llmClassifierModel?.trim() || undefined;
  const embeddingProvider = options.embeddingProvider ?? config.embedding.provider;
  const embeddingModel =
    options.embeddingModel?.trim() || config.embedding.model?.trim() || undefined;
  const embeddingPythonBin =
    options.embeddingPythonBin?.trim() || config.embedding.localPythonBin?.trim() || undefined;
  const embeddingCacheDir =
    options.embeddingCacheDir?.trim() || config.embedding.localCacheDir?.trim() || undefined;
  const embeddingDevice = options.embeddingDevice ?? config.embedding.localDevice;
  return {
    enabled: true,
    config: {
      dbPath: config.dbPath,
      autoCapture: config.autoCapture,
      autoRecall: config.autoRecall,
      reflectionEnabled: config.reflectionEnabled,
      consentMode: config.consentMode,
      piiMode: config.piiMode,
      maxInjectedChars: config.maxInjectedChars,
      captureMaxChars: config.captureMaxChars,
      reflectionMaxChars: config.reflectionMaxChars,
      reflectionMaxItems: config.reflectionMaxItems,
      defaultScope: config.defaultScope,
      allowedScopes: [...config.allowedScopes],
      embedding: {
        ...config.embedding,
        provider: embeddingProvider,
        ...(embeddingModel ? { model: embeddingModel } : {}),
        ...(embeddingPythonBin ? { localPythonBin: embeddingPythonBin } : {}),
        ...(embeddingCacheDir ? { localCacheDir: embeddingCacheDir } : {}),
        ...(embeddingDevice ? { localDevice: embeddingDevice } : {}),
      },
      advanced: {
        ...config.advanced,
        enableTurnScheduler: true,
        enableCompatibilityMemoryTools: false,
        llmClassifierEnabled,
        ...(llmClassifierModel ? { llmClassifierModel } : {}),
      },
    },
  };
}

function normalizeConfig(input: unknown): OpenClawConfigLike {
  if (!input || typeof input !== "object") {
    return {};
  }
  return input as OpenClawConfigLike;
}

async function readUserConfig(configPath: string): Promise<OpenClawConfigLike> {
  try {
    const raw = await readFile(configPath, "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch (error) {
    const message = String(error);
    if (message.includes("ENOENT")) {
      return {};
    }
    throw error;
  }
}

export function applyMemxSetupToConfig(
  appConfig: OpenClawConfigLike,
  pluginConfig: MemoryPluginConfig,
  options: MemxSetupOptions = {},
): OpenClawConfigLike {
  const next = normalizeConfig(structuredClone(appConfig));
  const currentAllow = new Set(withoutLegacyPluginIds(next.plugins?.allow));
  currentAllow.add(PLUGIN_ID);

  const existingEntries = { ...(next.plugins?.entries ?? {}) };
  const existingEntry =
    existingEntries[PLUGIN_ID] ?? existingEntries[LEGACY_MEMX_PLUGIN_ID] ?? {};
  delete existingEntries[LEGACY_MEMX_PLUGIN_ID];
  const existingHooks =
    existingEntry.hooks && typeof existingEntry.hooks === "object"
      ? (existingEntry.hooks as Record<string, unknown>)
      : {};
  const existingConfig =
    existingEntry.config && typeof existingEntry.config === "object"
      ? (existingEntry.config as Record<string, unknown>)
      : {};
  const setupConfig =
    (defaultSetupEntry(pluginConfig, options).config as Record<string, unknown>) ?? {};
  const setupEmbedding =
    setupConfig.embedding && typeof setupConfig.embedding === "object"
      ? (setupConfig.embedding as Record<string, unknown>)
      : {};
  const existingEmbedding =
    existingConfig.embedding && typeof existingConfig.embedding === "object"
      ? (existingConfig.embedding as Record<string, unknown>)
      : {};
  const setupAdvanced =
    setupConfig.advanced && typeof setupConfig.advanced === "object"
      ? (setupConfig.advanced as Record<string, unknown>)
      : {};
  const existingAdvanced =
    existingConfig.advanced && typeof existingConfig.advanced === "object"
      ? (existingConfig.advanced as Record<string, unknown>)
      : {};
  const setupEntry = {
    ...defaultSetupEntry(pluginConfig, options),
    ...existingEntry,
    hooks: {
      ...(typeof existingHooks.allowPromptInjection === "boolean"
        ? { allowPromptInjection: existingHooks.allowPromptInjection }
        : {}),
      allowPromptInjection: true,
    },
    config: {
      ...setupConfig,
      ...existingConfig,
      embedding: {
        ...setupEmbedding,
        ...existingEmbedding,
        ...(options.embeddingProvider ? { provider: options.embeddingProvider } : {}),
        ...(options.embeddingModel?.trim() ? { model: options.embeddingModel.trim() } : {}),
        ...(options.embeddingPythonBin?.trim()
          ? { localPythonBin: options.embeddingPythonBin.trim() }
          : {}),
        ...(options.embeddingCacheDir?.trim()
          ? { localCacheDir: options.embeddingCacheDir.trim() }
          : {}),
        ...(options.embeddingDevice ? { localDevice: options.embeddingDevice } : {}),
      },
      advanced: {
        ...setupAdvanced,
        ...existingAdvanced,
        enableTurnScheduler: true,
        enableCompatibilityMemoryTools: false,
        ...(options.enableLlmJudge === true ? { llmClassifierEnabled: true } : {}),
        ...(options.llmModel?.trim() ? { llmClassifierModel: options.llmModel.trim() } : {}),
      },
    },
    enabled: true,
  };

  next.plugins = {
    ...(next.plugins ?? {}),
    allow: [...currentAllow],
    slots: {
      ...(next.plugins?.slots ?? {}),
      memory: PLUGIN_ID,
    },
    entries: {
      ...existingEntries,
      [PLUGIN_ID]: setupEntry,
    },
  };

  return next;
}

export function buildMemxDoctorReport(params: {
  configPath: string;
  appConfig: OpenClawConfigLike;
  pluginConfig: MemoryPluginConfig;
}): MemxDoctorReport {
  const appConfig = normalizeConfig(params.appConfig);
  const memorySlot = appConfig.plugins?.slots?.memory ?? null;
  const allow = appConfig.plugins?.allow ?? [];
  const entry = appConfig.plugins?.entries?.[PLUGIN_ID] ?? {};
  const entryConfig =
    entry.config && typeof entry.config === "object"
      ? (entry.config as Record<string, unknown>)
      : {};
  const legacyTopLevelConfigKeys = [
    "dbPath",
    "autoCapture",
    "autoRecall",
    "reflectionEnabled",
    "consentMode",
    "piiMode",
    "maxInjectedChars",
    "captureMaxChars",
    "reflectionMaxChars",
    "reflectionMaxItems",
    "defaultScope",
    "allowedScopes",
    "embedding",
    "advanced",
  ].filter((key) => Object.prototype.hasOwnProperty.call(entry, key));
  const entryAdvanced =
    entryConfig.advanced && typeof entryConfig.advanced === "object"
      ? (entryConfig.advanced as Record<string, unknown>)
      : {};

  const checks = [
    {
      key: "plugin_loaded",
      ok: true,
      detail: `${MEMX_BRAND_NAME} CLI is available, so the plugin is currently loaded.`,
    },
    {
      key: "allowed",
      ok: allow.includes(PLUGIN_ID),
      detail: allow.includes(PLUGIN_ID)
        ? `plugins.allow includes ${PLUGIN_ID}.`
        : `plugins.allow does not include ${PLUGIN_ID}.`,
    },
    {
      key: "memory_slot",
      ok: memorySlot === PLUGIN_ID,
      detail:
        memorySlot === PLUGIN_ID
          ? `plugins.slots.memory points to ${PLUGIN_ID}.`
          : `plugins.slots.memory points to ${memorySlot ?? "nothing"}.`,
    },
    {
      key: "entry_enabled",
      ok: entry.enabled !== false,
      detail:
        entry.enabled !== false
          ? `plugins.entries.${PLUGIN_ID} is enabled.`
          : `plugins.entries.${PLUGIN_ID} is disabled.`,
    },
    {
      key: "config_nesting",
      ok: legacyTopLevelConfigKeys.length === 0,
      detail:
        legacyTopLevelConfigKeys.length === 0
          ? `plugin config keys are nested under plugins.entries.${PLUGIN_ID}.config.`
          : `legacy top-level plugin keys detected: ${legacyTopLevelConfigKeys.join(", ")}.`,
    },
    {
      key: "turn_scheduler",
      ok: entryAdvanced.enableTurnScheduler !== false,
      detail:
        entryAdvanced.enableTurnScheduler !== false
          ? "turn scheduler is enabled."
          : "turn scheduler is disabled.",
    },
    {
      key: "llm_classifier",
      ok: Boolean(
        entryAdvanced.llmClassifierEnabled ?? params.pluginConfig.advanced.llmClassifierEnabled,
      ),
      detail:
        (entryAdvanced.llmClassifierEnabled ?? params.pluginConfig.advanced.llmClassifierEnabled)
          ? `LLM classifier is enabled${
              typeof entryAdvanced.llmClassifierModel === "string"
                ? ` with ${entryAdvanced.llmClassifierModel}`
                : params.pluginConfig.advanced.llmClassifierModel
                  ? ` with ${params.pluginConfig.advanced.llmClassifierModel}`
                  : ""
            }.`
          : "LLM classifier is disabled; semantic extraction will fail closed.",
    },
  ];

  const recommendedFixes = checks
    .filter((check) => !check.ok)
    .map((check) => {
      switch (check.key) {
        case "allowed":
        case "memory_slot":
        case "entry_enabled":
        case "config_nesting":
        case "turn_scheduler":
          return "Run `openclaw memx setup` to write the recommended memX config.";
        case "llm_classifier":
          return `Run \`openclaw memx setup\` or set plugins.entries.${PLUGIN_ID}.config.advanced.llmClassifierEnabled=true.`;
        default:
          return "Review memX configuration.";
      }
    });

  return {
    ok: checks.every((check) => check.ok),
    configPath: params.configPath,
    reasonerConfigPath: null,
    pluginLoaded: true,
    checks,
    recommendedFixes: [...new Set(recommendedFixes)],
    configSummary: {
      allowed: allow.includes(PLUGIN_ID),
      memorySlot,
      pluginEnabled: entry.enabled !== false,
      turnSchedulerEnabled: entryAdvanced.enableTurnScheduler !== false,
      llmClassifierEnabled: Boolean(
        entryAdvanced.llmClassifierEnabled ?? params.pluginConfig.advanced.llmClassifierEnabled,
      ),
      llmClassifierModel:
        (typeof entryAdvanced.llmClassifierModel === "string"
          ? entryAdvanced.llmClassifierModel
          : params.pluginConfig.advanced.llmClassifierModel) ?? null,
      dbPath:
        (typeof entryConfig.dbPath === "string"
          ? entryConfig.dbPath
          : params.pluginConfig.dbPath) ?? null,
      embeddingProvider:
        (typeof (entryConfig.embedding as Record<string, unknown> | undefined)?.provider ===
        "string"
          ? ((entryConfig.embedding as Record<string, unknown>).provider as string)
          : params.pluginConfig.embedding.provider) ?? null,
      embeddingModel:
        (typeof (entryConfig.embedding as Record<string, unknown> | undefined)?.model === "string"
          ? ((entryConfig.embedding as Record<string, unknown>).model as string)
          : params.pluginConfig.embedding.model) ?? null,
    },
  };
}

async function runEmbeddingProbe(config: MemoryPluginConfig): Promise<EmbeddingProbeReport> {
  const startedAt = Date.now();
  const provider = config.embedding.provider;
  const model = config.embedding.model?.trim() || null;
  if (provider === "off") {
    return {
      enabled: false,
      ok: true,
      provider,
      model,
      dimension: null,
      durationMs: 0,
      detail: "embedding provider is off.",
    };
  }

  const backend = new OptionalEmbeddingBackend({} as never, config.embedding, {
    warn() {},
    info() {},
    debug() {},
    error() {},
  });
  try {
    await backend.prewarmLocalEmbeddings();
    const vectors = await backend.embedTextsBatch(["memx embedding probe"], "query");
    const dimension = vectors[0]?.length ?? 0;
    return {
      enabled: true,
      ok: dimension > 0,
      provider,
      model,
      dimension: dimension > 0 ? dimension : null,
      durationMs: Date.now() - startedAt,
      detail:
        dimension > 0
          ? "embedding request succeeded."
          : "embedding request returned no vector; retrieval will use lexical fallback.",
    };
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      provider,
      model,
      dimension: null,
      durationMs: Date.now() - startedAt,
      detail: `embedding request failed: ${String(error)}`,
    };
  } finally {
    await backend.close();
  }
}

async function writeUserConfig(configPath: string, config: OpenClawConfigLike): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function resolveConfigPath(input?: string): string {
  return resolveUserPath(input?.trim() || DEFAULT_USER_CONFIG_PATH);
}

function resolveAgentId(
  config: { agents?: { list?: Array<{ id?: string }> } },
  agent?: string,
): string {
  if (agent?.trim()) {
    return agent.trim();
  }
  const configured = config.agents?.list?.find((entry) => entry.id)?.id;
  return configured ?? "main";
}

function resolveEffectivePluginConfig(
  appConfig: OpenClawConfigLike,
  fallback: MemoryPluginConfig,
): MemoryPluginConfig {
  const entry =
    appConfig.plugins?.entries?.[PLUGIN_ID] ??
    appConfig.plugins?.entries?.[LEGACY_MEMX_PLUGIN_ID] ??
    {};
  const nested =
    entry.config && typeof entry.config === "object"
      ? (entry.config as Record<string, unknown>)
      : {};
  const advanced =
    nested.advanced && typeof nested.advanced === "object"
      ? (nested.advanced as Record<string, unknown>)
      : {};
  const embedding =
    nested.embedding && typeof nested.embedding === "object"
      ? (nested.embedding as Record<string, unknown>)
      : {};

  return {
    ...fallback,
    ...nested,
    embedding: {
      ...fallback.embedding,
      ...embedding,
    },
    advanced: {
      ...fallback.advanced,
      ...advanced,
    },
  };
}

async function withStore(params: {
  config: MemoryPluginConfig;
  appConfig: { agents?: { list?: Array<{ id?: string }> } };
  manager: MemxRuntimeManager;
  agent?: string;
  sessionKey?: string;
  workspaceDir?: string;
  run: (
    ctx: NonNullable<ReturnType<typeof buildOperationContext>>,
    store: Awaited<ReturnType<MemxRuntimeManager["getStore"]>>,
  ) => Promise<void>;
}) {
  const agentId = resolveAgentId(params.appConfig, params.agent);
  const ctx = buildOperationContext(params.config, {
    agentId,
    sessionKey: params.sessionKey,
    workspaceDir: params.workspaceDir,
  });
  if (!ctx) {
    throw new Error("agent context unavailable");
  }
  const store = await params.manager.getStore(ctx);
  await params.run(ctx, store);
}

async function printStats(
  ctx: NonNullable<ReturnType<typeof buildOperationContext>>,
  store: Awaited<ReturnType<MemxRuntimeManager["getStore"]>>,
) {
  const count = (table: string) =>
    Number(
      (store.client.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
        .count ?? 0,
    );
  console.log(
    JSON.stringify(
      {
        agentId: ctx.agentId,
        dbPath: ctx.dbPath,
        scopes: ctx.scopes,
        taskCount: count("conversation_tasks"),
        chunkCount: count("conversation_chunks"),
        stateCount: count("state_kv"),
        factCount: count("facts"),
        eventCount: count("episodic_events"),
        entityCount: count("entities"),
        edgeCount: count("graph_edges"),
        vectorDocCount: count("vector_docs"),
        policyDecisionCount: count("policy_decisions"),
        memorySignalCount: count("memory_signal_events"),
        beliefCount: count("memory_beliefs"),
        abstractionCandidateCount: count("abstraction_candidates"),
        strategyCount: count("strategy_hypotheses"),
      },
      null,
      2,
    ),
  );
}

function wipeAgentMemory(
  ctx: NonNullable<ReturnType<typeof buildOperationContext>>,
  store: Awaited<ReturnType<MemxRuntimeManager["getStore"]>>,
): MemxWipeStats {
  const deleted: Record<string, number> = {};
  let orphanEntitiesDeleted = 0;
  let orphanAliasesDeleted = 0;

  const countByAgent = (table: string, column = "agent_id"): number =>
    Number(
      (
        store.client
          .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`)
          .get(ctx.agentId) as { count: number }
      ).count ?? 0,
    );

  deleted.conversationChunks = countByAgent("conversation_chunks");
  deleted.conversationTasks = countByAgent("conversation_tasks");
  deleted.states = countByAgent("state_kv");
  deleted.facts = countByAgent("facts");
  deleted.factVersions = Number(
    (
      store.client
        .prepare(
          `SELECT COUNT(*) AS count
             FROM fact_versions
            WHERE fact_id IN (SELECT fact_id FROM facts WHERE agent_id = ?)`,
        )
        .get(ctx.agentId) as { count: number }
    ).count ?? 0,
  );
  deleted.events = countByAgent("episodic_events");
  deleted.edges = countByAgent("graph_edges");
  deleted.vectorDocs = countByAgent("vector_docs");
  deleted.vectorEmbeddings = countByAgent("vector_embeddings");
  deleted.retrievalAudit = countByAgent("retrieval_audit");
  deleted.policyDecisions = countByAgent("policy_decisions");
  deleted.maintenanceRuns = countByAgent("maintenance_runs");
  deleted.memorySignals = countByAgent("memory_signal_events");
  deleted.beliefs = countByAgent("memory_beliefs");
  deleted.abstractionCandidates = countByAgent("abstraction_candidates");
  deleted.strategies = countByAgent("strategy_hypotheses");

  store.client.withTransaction(() => {
    store.client
      .prepare(
        `DELETE FROM fact_versions
          WHERE fact_id IN (SELECT fact_id FROM facts WHERE agent_id = ?)`,
      )
      .run(ctx.agentId);
    store.client.prepare("DELETE FROM vector_embeddings WHERE agent_id = ?").run(ctx.agentId);
    store.client.prepare("DELETE FROM vector_docs_fts WHERE agent_id = ?").run(ctx.agentId);
    store.client.prepare("DELETE FROM vector_docs WHERE agent_id = ?").run(ctx.agentId);
    store.client.prepare("DELETE FROM state_kv WHERE agent_id = ?").run(ctx.agentId);
    store.client.prepare("DELETE FROM episodic_events WHERE agent_id = ?").run(ctx.agentId);
    store.client.prepare("DELETE FROM graph_edges WHERE agent_id = ?").run(ctx.agentId);
    store.client.prepare("DELETE FROM facts WHERE agent_id = ?").run(ctx.agentId);
    store.client.prepare("DELETE FROM retrieval_audit WHERE agent_id = ?").run(ctx.agentId);
    store.client.prepare("DELETE FROM policy_decisions WHERE agent_id = ?").run(ctx.agentId);
    store.client.prepare("DELETE FROM maintenance_runs WHERE agent_id = ?").run(ctx.agentId);
    store.client.prepare("DELETE FROM memory_signal_events WHERE agent_id = ?").run(ctx.agentId);
    store.client.prepare("DELETE FROM memory_beliefs WHERE agent_id = ?").run(ctx.agentId);
    store.client.prepare("DELETE FROM abstraction_candidates WHERE agent_id = ?").run(ctx.agentId);
    store.client.prepare("DELETE FROM strategy_hypotheses WHERE agent_id = ?").run(ctx.agentId);
    store.client.prepare("DELETE FROM conversation_chunks WHERE agent_id = ?").run(ctx.agentId);
    store.client.prepare("DELETE FROM conversation_tasks WHERE agent_id = ?").run(ctx.agentId);

    orphanAliasesDeleted = Number(
      (
        store.client
          .prepare(
            `SELECT COUNT(*) AS count
             FROM entity_aliases
            WHERE entity_id NOT IN (SELECT src_entity_id FROM graph_edges)
              AND entity_id NOT IN (SELECT dst_entity_id FROM graph_edges)`,
          )
          .get() as { count: number }
      ).count ?? 0,
    );
    store.client
      .prepare(
        `DELETE FROM entity_aliases
        WHERE entity_id NOT IN (SELECT src_entity_id FROM graph_edges)
          AND entity_id NOT IN (SELECT dst_entity_id FROM graph_edges)`,
      )
      .run();

    orphanEntitiesDeleted = Number(
      (
        store.client
          .prepare(
            `SELECT COUNT(*) AS count
             FROM entities
            WHERE entity_id NOT IN (SELECT src_entity_id FROM graph_edges)
              AND entity_id NOT IN (SELECT dst_entity_id FROM graph_edges)`,
          )
          .get() as { count: number }
      ).count ?? 0,
    );
    store.client
      .prepare(
        `DELETE FROM entities
        WHERE entity_id NOT IN (SELECT src_entity_id FROM graph_edges)
          AND entity_id NOT IN (SELECT dst_entity_id FROM graph_edges)`,
      )
      .run();
  });

  return {
    agentId: ctx.agentId,
    dbPath: ctx.dbPath,
    deleted,
    orphanEntitiesDeleted,
    orphanAliasesDeleted,
  };
}

function wipeDatabase(
  ctx: NonNullable<ReturnType<typeof buildOperationContext>>,
  store: Awaited<ReturnType<MemxRuntimeManager["getStore"]>>,
): MemxWipeDbStats {
  const deleted: Record<string, number> = {};
  const count = (table: string): number =>
    Number(
      (store.client.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
        .count ?? 0,
    );

  deleted.conversationChunks = count("conversation_chunks");
  deleted.conversationTasks = count("conversation_tasks");
  deleted.states = count("state_kv");
  deleted.facts = count("facts");
  deleted.factVersions = count("fact_versions");
  deleted.events = count("episodic_events");
  deleted.edges = count("graph_edges");
  deleted.entities = count("entities");
  deleted.entityAliases = count("entity_aliases");
  deleted.vectorDocs = count("vector_docs");
  deleted.vectorEmbeddings = count("vector_embeddings");
  deleted.vectorDocsFts = count("vector_docs_fts");
  deleted.retrievalAudit = count("retrieval_audit");
  deleted.policyDecisions = count("policy_decisions");
  deleted.maintenanceRuns = count("maintenance_runs");
  deleted.memorySignals = count("memory_signal_events");
  deleted.beliefs = count("memory_beliefs");
  deleted.abstractionCandidates = count("abstraction_candidates");
  deleted.strategies = count("strategy_hypotheses");

  store.client.withTransaction(() => {
    store.client.exec("DELETE FROM fact_versions;");
    store.client.exec("DELETE FROM vector_embeddings;");
    store.client.exec("DELETE FROM vector_docs_fts;");
    store.client.exec("DELETE FROM vector_docs;");
    store.client.exec("DELETE FROM retrieval_audit;");
    store.client.exec("DELETE FROM policy_decisions;");
    store.client.exec("DELETE FROM maintenance_runs;");
    store.client.exec("DELETE FROM memory_signal_events;");
    store.client.exec("DELETE FROM memory_beliefs;");
    store.client.exec("DELETE FROM abstraction_candidates;");
    store.client.exec("DELETE FROM strategy_hypotheses;");
    store.client.exec("DELETE FROM episodic_events;");
    store.client.exec("DELETE FROM graph_edges;");
    store.client.exec("DELETE FROM entity_aliases;");
    store.client.exec("DELETE FROM entities;");
    store.client.exec("DELETE FROM facts;");
    store.client.exec("DELETE FROM state_kv;");
    store.client.exec("DELETE FROM conversation_chunks;");
    store.client.exec("DELETE FROM conversation_tasks;");
  });

  return {
    dbPath: ctx.dbPath,
    deleted,
  };
}

export function registerMemxCli(params: {
  program: Command;
  pluginConfig: MemoryPluginConfig;
  appConfig: { agents?: { list?: Array<{ id?: string }> } };
  manager: MemxRuntimeManager;
}) {
  const command = params.program.command("memx").description("Manage memX databases");

  command
    .command("setup")
    .description("Write the recommended memX plugin config into openclaw.json")
    .option("--config <file>", "Path to openclaw.json")
    .option("--llm-judge", "Enable the MemOS-style LLM classifier/reasoner")
    .option("--llm-model <provider/model>", "Optional LLM classifier model override")
    .option(
      "--embedding-provider <provider>",
      "Embedding provider: off, openai-compatible, ollama, or sentence-transformers-local",
    )
    .option("--embedding-model <model>", "Embedding model id")
    .option("--embedding-python <bin>", "Python binary for sentence-transformers-local")
    .option("--embedding-cache-dir <dir>", "Model cache dir for sentence-transformers-local")
    .option("--embedding-device <device>", "Embedding device: auto, cpu, mps, or cuda")
    .option(
      "--local-embedding",
      "Shortcut for --embedding-provider sentence-transformers-local --embedding-model intfloat/multilingual-e5-small",
    )
    .action(
      async (options: {
        config?: string;
        llmJudge?: boolean;
        llmModel?: string;
        embeddingProvider?: string;
        embeddingModel?: string;
        embeddingPython?: string;
        embeddingCacheDir?: string;
        embeddingDevice?: string;
        localEmbedding?: boolean;
      }) => {
        const requestedProvider = options.localEmbedding
          ? "sentence-transformers-local"
          : options.embeddingProvider?.trim();
        if (
          requestedProvider &&
          !["off", "openai-compatible", "ollama", "sentence-transformers-local"].includes(
            requestedProvider,
          )
        ) {
          throw new Error(
            `unsupported embedding provider: ${requestedProvider}. Expected one of off, openai-compatible, ollama, sentence-transformers-local`,
          );
        }
        const requestedDevice = options.embeddingDevice?.trim();
        if (requestedDevice && !["auto", "cpu", "mps", "cuda"].includes(requestedDevice)) {
          throw new Error(
            `unsupported embedding device: ${requestedDevice}. Expected one of auto, cpu, mps, cuda`,
          );
        }
        const configPath = resolveConfigPath(options.config);
        const current = await readUserConfig(configPath);
        const next = applyMemxSetupToConfig(current, params.pluginConfig, {
          enableLlmJudge: Boolean(options.llmJudge),
          llmModel: options.llmModel,
          embeddingProvider: requestedProvider as MemxSetupOptions["embeddingProvider"],
          embeddingModel:
            options.embeddingModel?.trim() ||
            (options.localEmbedding ? "intfloat/multilingual-e5-small" : undefined),
          embeddingPythonBin: options.embeddingPython,
          embeddingCacheDir: options.embeddingCacheDir,
          embeddingDevice: requestedDevice as MemxSetupOptions["embeddingDevice"],
        });
        await writeUserConfig(configPath, next);
        console.log(
          JSON.stringify(
            {
              ok: true,
              configPath,
              configuredPlugin: PLUGIN_ID,
              memorySlot: PLUGIN_ID,
              llmClassifierEnabled:
                ((
                  (
                    next.plugins?.entries?.[PLUGIN_ID]?.config as
                      | Record<string, unknown>
                      | undefined
                  )?.advanced as Record<string, unknown> | undefined
                )?.llmClassifierEnabled as boolean | undefined) ?? false,
              llmClassifierModel:
                ((
                  (
                    next.plugins?.entries?.[PLUGIN_ID]?.config as
                      | Record<string, unknown>
                      | undefined
                  )?.advanced as Record<string, unknown> | undefined
                )?.llmClassifierModel as string | undefined) ?? null,
              embeddingProvider:
                ((
                  (
                    next.plugins?.entries?.[PLUGIN_ID]?.config as
                      | Record<string, unknown>
                      | undefined
                  )?.embedding as Record<string, unknown> | undefined
                )?.provider as string | undefined) ?? null,
              embeddingModel:
                ((
                  (
                    next.plugins?.entries?.[PLUGIN_ID]?.config as
                      | Record<string, unknown>
                      | undefined
                  )?.embedding as Record<string, unknown> | undefined
                )?.model as string | undefined) ?? null,
              nextStep: "Restart OpenClaw so the updated memX config is applied.",
            },
            null,
            2,
          ),
        );
      },
    );

  command
    .command("doctor")
    .description("Check whether OpenClaw is configured to use memX correctly")
    .option("--config <file>", "Path to openclaw.json")
    .option(
      "--deep",
      "Run live reasoner probes and report whether LLM semantic extraction is available",
    )
    .action(async (options: { config?: string; deep?: boolean }) => {
      const configPath = resolveConfigPath(options.config);
      const current = await readUserConfig(configPath);
      const report = buildMemxDoctorReport({
        configPath,
        appConfig: current,
        pluginConfig: params.pluginConfig,
      });
      if (options.deep) {
        const effectiveConfig = resolveEffectivePluginConfig(current, params.pluginConfig);
        const reasoner = new MemxReasoner(effectiveConfig, {
          warn() {},
          info() {},
          debug() {},
          error() {},
        });
        report.reasonerConfigPath = reasoner.getResolvedJudgeConfigPath();
        const [reasonerProbe, embeddingProbe] = await Promise.all([
          reasoner.runProbeSuite(),
          runEmbeddingProbe(effectiveConfig),
        ]);
        report.reasonerProbe = reasonerProbe;
        report.embeddingProbe = embeddingProbe;
      }
      console.log(JSON.stringify(report, null, 2));
    });

  command
    .command("stats")
    .option("--agent <id>", "Agent id")
    .action(async (options: { agent?: string }) => {
      await withStore({
        config: params.pluginConfig,
        appConfig: params.appConfig,
        manager: params.manager,
        agent: options.agent,
        run: async (ctx, store) => {
          await printStats(ctx, store);
        },
      });
    });

  command
    .command("vacuum")
    .option("--agent <id>", "Agent id")
    .action(async (options: { agent?: string }) => {
      await withStore({
        config: params.pluginConfig,
        appConfig: params.appConfig,
        manager: params.manager,
        agent: options.agent,
        run: async (_ctx, store) => {
          store.client.exec("VACUUM;");
          console.log(JSON.stringify({ ok: true }, null, 2));
        },
      });
    });

  command
    .command("inspect")
    .requiredOption("--id <id>", "Document id or record id")
    .option("--agent <id>", "Agent id")
    .action(async (options: { id: string; agent?: string }) => {
      await withStore({
        config: params.pluginConfig,
        appConfig: params.appConfig,
        manager: params.manager,
        agent: options.agent,
        run: async (_ctx, store) => {
          const doc = store.vectorRepo.getDoc(options.id);
          console.log(JSON.stringify(doc ?? { error: "not found", id: options.id }, null, 2));
        },
      });
    });

  command
    .command("export")
    .description("Export stored memory as JSONL")
    .option("--agent <id>", "Agent id")
    .option("--output <file>", "Output file")
    .action(async (options: { agent?: string; output?: string }) => {
      await withStore({
        config: params.pluginConfig,
        appConfig: params.appConfig,
        manager: params.manager,
        agent: options.agent,
        run: async (_ctx, store) => {
          const payload = [
            ...store.vectorRepo.listDocs({
              agentId: _ctx.agentId,
              scopes: _ctx.scopes,
              limit: 5000,
            }),
          ]
            .map((entry) => JSON.stringify(entry))
            .join("\n");
          if (options.output) {
            await writeFile(options.output, `${payload}\n`, "utf8");
            console.log(JSON.stringify({ ok: true, output: options.output }, null, 2));
            return;
          }
          console.log(payload);
        },
      });
    });

  command
    .command("export-jsonl")
    .description("Alias for export")
    .option("--agent <id>", "Agent id")
    .option("--output <file>", "Output file")
    .action(async (options: { agent?: string; output?: string }) => {
      await withStore({
        config: params.pluginConfig,
        appConfig: params.appConfig,
        manager: params.manager,
        agent: options.agent,
        run: async (ctx, store) => {
          const payload = store.vectorRepo
            .listDocs({ agentId: ctx.agentId, scopes: ctx.scopes, limit: 5000 })
            .map((entry) => JSON.stringify(entry))
            .join("\n");
          if (options.output) {
            await writeFile(options.output, `${payload}\n`, "utf8");
            console.log(JSON.stringify({ ok: true, output: options.output }, null, 2));
            return;
          }
          console.log(payload);
        },
      });
    });

  command
    .command("forget")
    .requiredOption("--id <id>", "Document id to delete")
    .option("--agent <id>", "Agent id")
    .action(async (options: { id: string; agent?: string }) => {
      await withStore({
        config: params.pluginConfig,
        appConfig: params.appConfig,
        manager: params.manager,
        agent: options.agent,
        run: async (_ctx, store) => {
          store.vectorRepo.deleteDocs([options.id]);
          console.log(JSON.stringify({ ok: true, deleted: options.id }, null, 2));
        },
      });
    });

  command
    .command("wipe")
    .description("Delete all memX data for one agent from the current memx database")
    .requiredOption("--yes", "Confirm the destructive wipe")
    .option("--agent <id>", "Agent id")
    .action(async (options: { yes?: boolean; agent?: string }) => {
      if (!options.yes) {
        throw new Error("refusing to wipe memory without --yes");
      }
      await withStore({
        config: params.pluginConfig,
        appConfig: params.appConfig,
        manager: params.manager,
        agent: options.agent,
        run: async (ctx, store) => {
          const stats = wipeAgentMemory(ctx, store);
          console.log(
            JSON.stringify(
              {
                ok: true,
                ...stats,
              },
              null,
              2,
            ),
          );
        },
      });
    });

  command
    .command("wipe-db")
    .description(
      "Delete all data from the current memX database file while keeping the schema",
    )
    .requiredOption("--yes", "Confirm the destructive database wipe")
    .option("--agent <id>", "Agent id used to resolve the target dbPath")
    .action(async (options: { yes?: boolean; agent?: string }) => {
      if (!options.yes) {
        throw new Error("refusing to wipe database without --yes");
      }
      await withStore({
        config: params.pluginConfig,
        appConfig: params.appConfig,
        manager: params.manager,
        agent: options.agent,
        run: async (ctx, store) => {
          const stats = wipeDatabase(ctx, store);
          console.log(
            JSON.stringify(
              {
                ok: true,
                ...stats,
              },
              null,
              2,
            ),
          );
        },
      });
    });

  command
    .command("prune")
    .option("--agent <id>", "Agent id")
    .action(async (options: { agent?: string }) => {
      await withStore({
        config: params.pluginConfig,
        appConfig: params.appConfig,
        manager: params.manager,
        agent: options.agent,
        run: async (ctx, store) => {
          const stats = await runConsolidation(store, { ...ctx, now: nowIso() });
          console.log(JSON.stringify(stats, null, 2));
        },
      });
    });

  command
    .command("consolidate")
    .option("--agent <id>", "Agent id")
    .action(async (options: { agent?: string }) => {
      await withStore({
        config: params.pluginConfig,
        appConfig: params.appConfig,
        manager: params.manager,
        agent: options.agent,
        run: async (ctx, store) => {
          const stats = await runConsolidation(store, { ...ctx, now: nowIso() });
          console.log(JSON.stringify(stats, null, 2));
        },
      });
    });

  command
    .command("abstraction-jobs")
    .description("Run the standalone abstraction candidate pass without changing canonical memory")
    .option("--agent <id>", "Agent id")
    .option("--refine-llm", "Enable maintenance LLM refinement for abstraction candidates")
    .action(async (options: { agent?: string; refineLlm?: boolean }) => {
      await withStore({
        config: params.pluginConfig,
        appConfig: params.appConfig,
        manager: params.manager,
        agent: options.agent,
        run: async (ctx, store) => {
          const stats = await runAbstractionJobs(store, { ...ctx, now: nowIso() }, {
            refineWithLlm: options.refineLlm === true,
          });
          console.log(JSON.stringify(stats, null, 2));
        },
      });
    });

  command
    .command("abstraction-promote")
    .description("Run the standalone abstraction promotion pass")
    .option("--agent <id>", "Agent id")
    .action(async (options: { agent?: string }) => {
      await withStore({
        config: params.pluginConfig,
        appConfig: params.appConfig,
        manager: params.manager,
        agent: options.agent,
        run: async (ctx, store) => {
          const stats = runAbstractionPromotion(store, { ...ctx, now: nowIso() });
          console.log(JSON.stringify(stats, null, 2));
        },
      });
    });

  command
    .command("rebuild-fts")
    .option("--agent <id>", "Agent id")
    .action(async (options: { agent?: string }) => {
      await withStore({
        config: params.pluginConfig,
        appConfig: params.appConfig,
        manager: params.manager,
        agent: options.agent,
        run: async (ctx, store) => {
          const docs = store.vectorRepo.listDocs({
            agentId: ctx.agentId,
            scopes: ctx.scopes,
            limit: 5000,
          });
          store.client.exec("DELETE FROM vector_docs_fts;");
          store.retrievalBackend.upsertDocs(docs);
          console.log(JSON.stringify({ ok: true, rebuilt: docs.length }, null, 2));
        },
      });
    });

  command
    .command("reindex")
    .option("--agent <id>", "Agent id")
    .action(async (options: { agent?: string }) => {
      await withStore({
        config: params.pluginConfig,
        appConfig: params.appConfig,
        manager: params.manager,
        agent: options.agent,
        run: async (ctx, store) => {
          const docs = store.vectorRepo.listDocs({
            agentId: ctx.agentId,
            scopes: ctx.scopes,
            limit: 5000,
          });
          store.retrievalBackend.upsertDocs(docs);
          console.log(JSON.stringify({ ok: true, reindexed: docs.length }, null, 2));
        },
      });
    });
}
